import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { DeveloperWorkbench } from './components/DeveloperWorkbench';
import { Toolbar } from './components/Toolbar';
import { Sidebar, ActiveSidebarTab } from './components/Sidebar';
import { SolutionExplorer } from './components/SolutionExplorer';
import { CodeEditor, type EditorThemeId } from './components/CodeEditor';
import { DebugPanel } from './components/DebugPanel';
import { TestExplorer } from './components/TestExplorer';
import { NuGetManager } from './components/NuGetManager';
import { BottomPanel } from './components/BottomPanel';
import { SetupModal } from './components/SetupModal';
import { QuickOpenModal } from './components/QuickOpenModal';
import { SettingsModal } from './components/SettingsModal';
import { ShortcutsModal } from './components/ShortcutsModal';
import { FinderNotification } from './components/FinderNotification';
import { AppSettingsEnvModal } from './components/AppSettingsEnvModal';
import { ImplementationPickerModal } from './components/ImplementationPickerModal';
import { NewFileModal, CSharpTemplateKind } from './components/NewFileModal';
import { EvaluateExpressionModal } from './components/EvaluateExpressionModal';
import { GitPanel } from './components/GitPanel';
import { CurlPreviewModal } from './components/CurlPreviewModal';
import { ExtensionsPanel } from './components/ExtensionsPanel';
import { PortConfigModal } from './components/PortConfigModal';
import {
  SAMPLE_SOLUTIONS,
  INITIAL_TESTS,
  MOCK_DIAGNOSTICS
} from './data/sampleSolutions';
import {
  SolutionFile,
  ProjectItem,
  SolutionFileItem,
  Breakpoint,
  StackFrame,
  VariableItem,
  TestItem,
  DiagnosticItem,
  ReferenceItem,
  ImplementationItem,
  ReturnValueEntry,
  ExecutionTraceStep,
  MarketplaceExtension,
  NuGetPackage,
  ActivePortProcess,
  ProjectPortConfig,
  RecentSolutionEntry
} from './types/minirider';
import type { GitChangeItem } from './types/electron';
import {
  resolveCSharpDefinition,
  resolveCSharpImplementations,
  resolveCSharpUsages,
  searchInSolution,
  getAllSolutionFiles,
  getOrBuildSolutionIndex,
  discoverSolutionTests
} from './utils/csharpSymbolNavigator';
import {
  parseBrowserSolutionFile,
  parseBrowserDirectoryFiles
} from './utils/browserSolutionLoader';
import {
  parseCombinedDotnetTestResults,
  mergeTestResults
} from './utils/testResultParser';
import {
  buildCSharpConversionExpression,
  convertEvaluatedValueLocally,
  evaluateSampleExpression,
  updateSampleVariableValue,
  type EvaluatedDebugValue
} from './utils/debugExpressionHelper';
import {
  parseHttpCallAtLine,
  buildCurlFromCall,
  type DetectedHttpCall,
  type GeneratedCurlResult
} from './utils/curlGenerator';
import {
  extractReturnValuesFromVariables,
  formatShortFunctionName
} from './utils/callStackFilter';
import {
  buildUrlForPort,
  resolveEffectiveLaunchConfig,
  resolveProjectPortInfo
} from './utils/portConfigHelper';

interface HistoryEntry {
  file: SolutionFileItem;
  line: number;
  column: number;
}

function frameworkToSdkLabel(tf?: string): string | null {
  const lower = (tf || '').toLowerCase();
  if (lower.startsWith('net10')) return '.NET 10.0';
  if (lower.startsWith('net9')) return '.NET 9.0';
  if (lower.startsWith('net8')) return '.NET 8.0';
  if (lower.startsWith('net7')) return '.NET 7.0';
  if (lower.startsWith('net6')) return '.NET 6.0';
  return null;
}

function sdkLabelToTfm(sdkLabel: string): string {
  if (sdkLabel.includes('10.0')) return 'net10.0';
  if (sdkLabel.includes('9.0')) return 'net9.0';
  if (sdkLabel.includes('8.0')) return 'net8.0';
  if (sdkLabel.includes('7.0')) return 'net7.0';
  if (sdkLabel.includes('6.0')) return 'net6.0';
  const match = sdkLabel.match(/^(\d+)\.(\d+)/);
  return match ? `net${match[1]}.${match[2]}` : 'net10.0';
}

function parseMsBuildDiagnostics(lines: string[], fallbackDir?: string): DiagnosticItem[] {
  const results: DiagnosticItem[] = [];
  const regex = /^(.*?)\((\d+),(\d+)\):\s*(error|warning)\s+([A-Z0-9]+):\s*(.+?)(?:\s+\[([^\]]+)\])?$/i;
  lines.forEach((raw, idx) => {
    const match = raw.trim().match(regex);
    if (match) {
      let filePath = match[1].trim().replace(/\\/g, '/');
      const projPath = match[7]?.trim().replace(/\\/g, '/');
      if (!filePath.startsWith('/') && !/^[A-Za-z]:\//.test(filePath)) {
        const baseDir = projPath && projPath.includes('/')
          ? projPath.slice(0, projPath.lastIndexOf('/'))
          : fallbackDir;
        if (baseDir) {
          filePath = `${baseDir.replace(/\/$/, '')}/${filePath.replace(/^\.\//, '')}`;
        }
      }
      results.push({
        id: `msbuild-${idx}-${match[5]}`,
        file: filePath,
        line: Number(match[2]) || 1,
        column: Number(match[3]) || 1,
        severity: match[4].toLowerCase() === 'error' ? 'error' : 'warning',
        code: match[5],
        message: match[6].trim(),
        source: 'MSBuild'
      });
    }
  });
  return results;
}

function generateCSharpTemplate(
  rawName: string,
  template: CSharpTemplateKind,
  namespaceName: string,
  sdkLabel: string
): { fileName: string; ext: string; content: string } {
  const cleanBase = rawName.replace(/\.(cs|json)$/i, '');
  if (template === 'json') {
    const fileName = rawName.toLowerCase().endsWith('.json') ? rawName : `${cleanBase}.json`;
    return {
      fileName,
      ext: '.json',
      content: `{\n  "Logging": {\n    "LogLevel": {\n      "Default": "Information"\n    }\n  }\n}\n`
    };
  }

  const fileName = rawName.toLowerCase().endsWith('.cs') ? rawName : `${cleanBase}.cs`;
  switch (template) {
    case 'interface': {
      const ifaceName = cleanBase.startsWith('I') ? cleanBase : `I${cleanBase}`;
      return {
        fileName: rawName.toLowerCase().endsWith('.cs') ? rawName : `${ifaceName}.cs`,
        ext: '.cs',
        content: `namespace ${namespaceName};\n\npublic interface ${ifaceName}\n{\n    Task ExecuteAsync(CancellationToken cancellationToken = default);\n}\n`
      };
    }
    case 'record':
      return {
        fileName,
        ext: '.cs',
        content: `namespace ${namespaceName};\n\npublic sealed record ${cleanBase}(Guid Id, string Name, DateTime CreatedAtUtc);\n`
      };
    case 'controller':
      return {
        fileName,
        ext: '.cs',
        content: `using Microsoft.AspNetCore.Mvc;\n\nnamespace ${namespaceName};\n\n[ApiController]\n[Route("api/[controller]")]\npublic class ${cleanBase} : ControllerBase\n{\n    [HttpGet]\n    public IActionResult Get()\n    {\n        return Ok(new { status = "ok", runtime = "${sdkLabel}" });\n    }\n}\n`
      };
    case 'test':
      return {
        fileName,
        ext: '.cs',
        content: `using Xunit;\n\nnamespace ${namespaceName};\n\npublic class ${cleanBase}\n{\n    [Fact]\n    public void Should_Pass_Expected_Behavior()\n    {\n        Assert.True(true);\n    }\n}\n`
      };
    default:
      return {
        fileName,
        ext: '.cs',
        content: `namespace ${namespaceName};\n\npublic class ${cleanBase}\n{\n    public ${cleanBase}()\n    {\n    }\n}\n`
      };
  }
}

function pickRunnableProject(projects: ProjectItem[]): ProjectItem | undefined {
  return (
    projects.find(p => p.projectType === 'webapi') ||
    projects.find(p => p.projectType === 'console') ||
    projects.find(
      p =>
        p.projectType !== 'test' &&
        getAllSolutionFiles({ name: '', path: '', format: 'sln', projects: [p] }).some(
          f => f.file.name.toLowerCase() === 'program.cs'
        )
    ) ||
    projects[0]
  );
}

function getProjectLaunchEnv(
  project?: ProjectItem,
  portOverride?: ProjectPortConfig | null
): { env: Record<string, string>; url: string | null } {
  const cfg = resolveEffectiveLaunchConfig(project, portOverride);
  return { env: cfg.env, url: cfg.url };
}

export default function App() {
  // Solution and Project State
  const [solutions, setSolutions] = useState<SolutionFile[]>(SAMPLE_SOLUTIONS);
  const [currentSolution, setCurrentSolution] = useState<SolutionFile>(SAMPLE_SOLUTIONS[0]);
  const [selectedProject, setSelectedProject] = useState<ProjectItem>(
    () => pickRunnableProject(SAMPLE_SOLUTIONS[0].projects) || SAMPLE_SOLUTIONS[0].projects[0]
  );
  const [buildConfig, setBuildConfig] = useState<'Debug' | 'Release'>('Debug');
  const [isRestoringDeps, setIsRestoringDeps] = useState(false);

  // Resizable IDE Layout & Editor Theme
  const [sidebarWidth, setSidebarWidth] = useState<number>(272);
  const outputFragments = useRef(new Map<string, string>());
  const [workbenchOpen, setWorkbenchOpen] = useState(false);
  const [bottomPanelHeight, setBottomPanelHeight] = useState<number>(256);
  const [editorTheme, setEditorTheme] = useState<EditorThemeId>('sharpforge-dark');

  // .NET Multi-Version SDK State (.NET 10, 9, 8, 7, 6)
  const [detectedSdks, setDetectedSdks] = useState<string[]>([
    '10.0.302',
    '9.0.100',
    '8.0.417',
    '7.0.410',
    '6.0.428'
  ]);
  const [activeSdk, setActiveSdk] = useState<string>('.NET 10.0');

  // Initial Sample File Lookup
  const usersCtrlFile =
    currentSolution.projects[0]?.files
      .find(f => f.name === 'Controllers')?.children
      ?.find(f => f.name === 'UsersController.cs') ||
    currentSolution.projects[0]?.files[0];

  const userServiceFile = currentSolution.projects[1]?.files
    .find(f => f.name === 'Services')?.children
    ?.find(f => f.name === 'UserService.cs');

  // File & Editor State
  const [openFiles, setOpenFiles] = useState<SolutionFileItem[]>(usersCtrlFile ? [usersCtrlFile] : []);
  const [activeFile, setActiveFile] = useState<SolutionFileItem | null>(usersCtrlFile || null);
  const [dirtyFileIds, setDirtyFileIds] = useState<Set<string>>(new Set());

  // Exact Line/Column Cursor & Navigation History Stack
  const [activeLine, setActiveLine] = useState<number | undefined>(undefined);
  const [activeColumn, setActiveColumn] = useState<number | undefined>(undefined);
  const [navigationNonce, setNavigationNonce] = useState<number>(0);

  const initialHistory: HistoryEntry[] = usersCtrlFile
    ? [{ file: usersCtrlFile, line: 1, column: 1 }]
    : [];
  const [navHistory, setNavHistory] = useState<HistoryEntry[]>(initialHistory);
  const [navIndex, setNavIndex] = useState<number>(initialHistory.length > 0 ? 0 : -1);

  const navHistoryRef = useRef<HistoryEntry[]>(navHistory);
  navHistoryRef.current = navHistory;
  const navIndexRef = useRef<number>(navIndex);
  navIndexRef.current = navIndex;
  const currentCursorRef = useRef<{ line: number; column: number }>({ line: 1, column: 1 });
  const lastOpenedSolutionRef = useRef<{ path: string; ts: number } | null>(null);
  const activeProcessIdRef = useRef<string | null>(null);

  // Hidden Browser File / Folder Inputs for Web Fallback
  const slnInputRef = useRef<HTMLInputElement>(null);
  const folderInputRef = useRef<HTMLInputElement>(null);

  // Active Tool Windows
  const [activeSidebarTab, setActiveSidebarTab] = useState<ActiveSidebarTab>('explorer');
  const [locateInExplorerNonce, setLocateInExplorerNonce] = useState<number>(0);
  const [isBottomPanelOpen, setIsBottomPanelOpen] = useState(true);
  const [bottomPanelTab, setBottomPanelTab] = useState<'terminal' | 'build' | 'debug' | 'flow' | 'ports' | 'problems' | 'references' | 'breakpoints'>('terminal');

  // Port Configuration Overrides & Active OS Ports
  const [portOverrides, setPortOverrides] = useState<Record<string, ProjectPortConfig>>(() => {
    try {
      const saved =
        localStorage.getItem('sharpforge.portOverrides') ??
        localStorage.getItem('minirider.portOverrides');
      return saved ? JSON.parse(saved) : {};
    } catch {
      return {};
    }
  });
  const [activePorts, setActivePorts] = useState<ActivePortProcess[]>([]);
  const [isScanningPorts, setIsScanningPorts] = useState(false);
  const [portModalState, setPortModalState] = useState<{
    isOpen: boolean;
    pendingLaunchMode: 'run' | 'debug' | null;
  }>({
    isOpen: false,
    pendingLaunchMode: null
  });

  // Recent Solutions Memory (persisted to ~/.sharpforge/recent-solutions.json & localStorage)
  const [recentSolutions, setRecentSolutions] = useState<RecentSolutionEntry[]>(() => {
    try {
      const saved =
        localStorage.getItem('sharpforge.recentSolutions') ??
        localStorage.getItem('minirider.recentSolutions');
      return saved ? JSON.parse(saved) : [];
    } catch {
      return [];
    }
  });
  const startupRestoreAttemptedRef = useRef(false);

  // Execution & Debugger State
  const [isBuilding, setIsBuilding] = useState(false);
  const [isRunning, setIsRunning] = useState(false);
  const [isDebugging, setIsDebugging] = useState(false);
  const [isPaused, setIsPaused] = useState(false);
  const [debugStepIndex, setDebugStepIndex] = useState(0);
  const [runningUrl, setRunningUrl] = useState<string | null>(null);
  const [missingDebuggerMessage, setMissingDebuggerMessage] = useState<string | null>(null);

  // Breakpoints
  const [breakpoints, setBreakpoints] = useState<Breakpoint[]>(
    usersCtrlFile
      ? [{ id: 'bp-1', filePath: usersCtrlFile.path, line: 24, enabled: true }]
      : []
  );

  const [pausedLocation, setPausedLocation] = useState<{ filePath: string; line: number } | null>(null);
  const [callStack, setCallStack] = useState<StackFrame[]>([]);
  const [selectedFrameId, setSelectedFrameId] = useState<number>(1);
  const [variables, setVariables] = useState<VariableItem[]>([]);
  const [returnValues, setReturnValues] = useState<ReturnValueEntry[]>([]);
  const [executionTrace, setExecutionTrace] = useState<ExecutionTraceStep[]>([]);
  const [watchExpressions, setWatchExpressions] = useState<{ id: string; expression: string; value: string }[]>([
    { id: 'w-1', expression: 'id', value: '42' },
    { id: 'w-2', expression: 'user == null', value: 'false' }
  ]);

  // cURL Generator Modal
  const [curlModalState, setCurlModalState] = useState<{
    isOpen: boolean;
    curlData: GeneratedCurlResult | null;
    detectedCall: DetectedHttpCall | null;
    isGenerating: boolean;
    error: string | null;
  }>({
    isOpen: false,
    curlData: null,
    detectedCall: null,
    isGenerating: false,
    error: null
  });

  // Installed Extensions / Plugins (VS Code & JetBrains)
  const [installedExtensions, setInstalledExtensions] = useState<MarketplaceExtension[]>(() => {
    try {
      const saved =
        localStorage.getItem('sharpforge.extensions') ??
        localStorage.getItem('minirider.extensions');
      return saved ? JSON.parse(saved) : [];
    } catch {
      return [];
    }
  });

  const customThemes = useMemo(() => {
    return installedExtensions
      .filter(e => e.enabled !== false && e.themes && e.themes.length > 0)
      .flatMap(e => e.themes || []);
  }, [installedExtensions]);

  const currentPortOverride = useMemo(
    () => (selectedProject ? portOverrides[selectedProject.path] || null : null),
    [portOverrides, selectedProject]
  );

  const resolvedProjectLaunch = useMemo(
    () => resolveEffectiveLaunchConfig(selectedProject, currentPortOverride),
    [selectedProject, currentPortOverride]
  );

  const isConfiguredPortInUse = useMemo(() => {
    if (!resolvedProjectLaunch.port) return false;
    return activePorts.some(p => p.port === resolvedProjectLaunch.port);
  }, [activePorts, resolvedProjectLaunch.port]);

  // Tests State
  const [tests, setTests] = useState<TestItem[]>(INITIAL_TESTS);
  const [isRunningTests, setIsRunningTests] = useState(false);

  // Diagnostics, References & Solution Search
  const [diagnostics, setDiagnostics] = useState<DiagnosticItem[]>(MOCK_DIAGNOSTICS);
  const [references, setReferences] = useState<ReferenceItem[]>([]);
  const [solutionSearchQuery, setSolutionSearchQuery] = useState('');
  const [solutionSearchResults, setSolutionSearchResults] = useState<ReferenceItem[]>([]);

  // Real Git State
  const [gitBranch, setGitBranch] = useState('main');
  const [gitIsRepo, setGitIsRepo] = useState(false);
  const [gitChanges, setGitChanges] = useState<GitChangeItem[]>([]);
  const [gitDiffPreview, setGitDiffPreview] = useState<{ file: string; diff: string } | null>(null);

  // Logs
  const [terminalLogs, setTerminalLogs] = useState<string[]>([
    'Welcome to SharpForge — Enterprise C#/.NET IDE for macOS',
    'Supported .NET SDKs: .NET 10.0, .NET 9.0, .NET 8.0, .NET 7.0, .NET 6.0',
    'Loaded solution: ' + SAMPLE_SOLUTIONS[0].name + ' (' + SAMPLE_SOLUTIONS[0].projects.length + ' projects evaluated via MSBuild)',
    'Click "Open .sln" (⌘O) to load any enterprise .NET solution with full dependency & symbol resolution.'
  ]);
  const [buildLogs, setBuildLogs] = useState<string[]>([]);
  const [debugLogs, setDebugLogs] = useState<string[]>([]);

  // Modals & Notifications
  const [isSetupModalOpen, setIsSetupModalOpen] = useState(false);
  const [isQuickOpenOpen, setIsQuickOpenOpen] = useState(false);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [isShortcutsOpen, setIsShortcutsOpen] = useState(false);
  const [finderPath, setFinderPath] = useState<string | null>(null);
  const [newFileModalState, setNewFileModalState] = useState<{
    isOpen: boolean;
    project: ProjectItem | null;
    folderRelativePath?: string;
  }>({ isOpen: false, project: null });

  // AppSettings Environment Variables Modal
  const [isAppSettingsModalOpen, setIsAppSettingsModalOpen] = useState(false);
  const [appSettingsTargetFile, setAppSettingsTargetFile] = useState<SolutionFileItem | null>(null);

  // Go to Implementation / Definition Picker Modal
  const [isImplementationPickerOpen, setIsImplementationPickerOpen] = useState(false);
  const [implementationPickerData, setImplementationPickerData] = useState<{
    symbolName: string;
    items: ImplementationItem[];
  }>({ symbolName: '', items: [] });

  // Runtime Evaluate / Change Value Modal (⌥F8)
  const [evaluateModalState, setEvaluateModalState] = useState<{
    isOpen: boolean;
    expression: string;
    mode: 'evaluate' | 'setValue';
  }>({ isOpen: false, expression: '', mode: 'evaluate' });

  // Navigation Toast Banner
  const [navNotification, setNavNotification] = useState<{ message: string; sub?: string } | null>(null);
  const navToastTimerRef = useRef<number | null>(null);

  // Settings
  const [sdkPath, setSdkPath] = useState('/usr/local/share/dotnet');
  const [debuggerPath, setDebuggerPath] = useState('/usr/local/bin/netcoredbg');

  const isSampleSolution = SAMPLE_SOLUTIONS.some(s => s.path === currentSolution.path);
  const isRealDiskSolution = Boolean(window.electronAPI?.runCommand) && !isSampleSolution;

  const getSolutionDir = (slnPath: string) => {
    if (!slnPath.includes('/')) return undefined;
    if (!/\.(sln|slnx|csproj|fsproj)$/i.test(slnPath)) return slnPath;
    const idx = slnPath.lastIndexOf('/');
    return idx > 0 ? slnPath.slice(0, idx) : undefined;
  };

  const showNavToast = useCallback((message: string, sub?: string) => {
    setNavNotification({ message, sub });
    if (navToastTimerRef.current) {
      window.clearTimeout(navToastTimerRef.current);
    }
    navToastTimerRef.current = window.setTimeout(() => setNavNotification(null), 3200);
  }, []);

  // Refresh Git status for disk-backed solutions
  const refreshGitStatus = useCallback(
    async (slnPath: string = currentSolution.path) => {
      const dir = getSolutionDir(slnPath);
      if (window.electronAPI?.gitStatus && dir && slnPath.startsWith('/') && !slnPath.startsWith('/Users/developer/')) {
        const res = await window.electronAPI.gitStatus(dir);
        setGitIsRepo(res.isRepo);
        setGitBranch(res.branch || 'main');
        setGitChanges(res.changes || []);
      } else {
        setGitIsRepo(false);
        setGitBranch('main');
        setGitChanges([]);
      }
    },
    [currentSolution.path]
  );

  // Helper to find file across current solution
  const findFileByPath = useCallback(
    (targetPath: string, sol: SolutionFile = currentSolution): SolutionFileItem | null => {
      if (!targetPath) return null;
      const normTarget = targetPath.replace(/\\/g, '/').toLowerCase();
      const all = getAllSolutionFiles(sol);

      const exact = all.find(f => f.file.path.replace(/\\/g, '/') === targetPath.replace(/\\/g, '/'));
      if (exact) return exact.file;

      const caseInsensitive = all.find(f => f.file.path.replace(/\\/g, '/').toLowerCase() === normTarget);
      if (caseInsensitive) return caseInsensitive.file;

      const suffix = all.find(f => {
        const p = f.file.path.replace(/\\/g, '/').toLowerCase();
        const rel = f.file.relativePath.replace(/\\/g, '/').toLowerCase();
        return p.endsWith(normTarget) || normTarget.endsWith(rel);
      });
      if (suffix) return suffix.file;

      const fileName = normTarget.split('/').pop();
      if (fileName) {
        const byName = all.find(f => f.file.name.toLowerCase() === fileName);
        if (byName) return byName.file;
      }

      return null;
    },
    [currentSolution]
  );

  // Core Navigation Helper with Back / Forward History Tracking
  const navigateToLocation = useCallback(
    (file: SolutionFileItem, line = 1, column = 1, pushHistory = true) => {
      if (file.isDirectory) return;

      setOpenFiles(prev => (prev.some(f => f.id === file.id || f.path === file.path) ? prev : [...prev, file]));
      setActiveFile(file);

      if (pushHistory) {
        const hist = [...navHistoryRef.current];
        const idx = navIndexRef.current;

        if (idx >= 0 && hist[idx]) {
          hist[idx] = {
            ...hist[idx],
            line: currentCursorRef.current.line || hist[idx].line,
            column: currentCursorRef.current.column || hist[idx].column
          };
        }

        const currentEntry = idx >= 0 ? hist[idx] : undefined;
        const isSameSpot =
          currentEntry &&
          currentEntry.file.path === file.path &&
          Math.abs(currentEntry.line - line) <= 1;

        if (!isSameSpot) {
          const nextHist = hist.slice(0, idx + 1);
          nextHist.push({ file, line, column });
          const trimmed = nextHist.length > 100 ? nextHist.slice(nextHist.length - 100) : nextHist;
          navHistoryRef.current = trimmed;
          navIndexRef.current = trimmed.length - 1;
          setNavHistory(trimmed);
          setNavIndex(trimmed.length - 1);
        }
      }

      currentCursorRef.current = { line, column };
      setActiveLine(line);
      setActiveColumn(column);
      setNavigationNonce(n => n + 1);
    },
    []
  );

  const handleNavigateBack = useCallback(() => {
    const idx = navIndexRef.current;
    const hist = navHistoryRef.current;
    if (idx <= 0) return;

    const updated = [...hist];
    if (updated[idx]) {
      updated[idx] = {
        ...updated[idx],
        line: currentCursorRef.current.line || updated[idx].line,
        column: currentCursorRef.current.column || updated[idx].column
      };
      navHistoryRef.current = updated;
      setNavHistory(updated);
    }

    const prevIdx = idx - 1;
    const entry = updated[prevIdx];
    if (!entry) return;

    navIndexRef.current = prevIdx;
    setNavIndex(prevIdx);
    navigateToLocation(entry.file, entry.line, entry.column, false);
  }, [navigateToLocation]);

  const handleNavigateForward = useCallback(() => {
    const idx = navIndexRef.current;
    const hist = navHistoryRef.current;
    if (idx < 0 || idx >= hist.length - 1) return;

    const nextIdx = idx + 1;
    const entry = hist[nextIdx];
    if (!entry) return;

    navIndexRef.current = nextIdx;
    setNavIndex(nextIdx);
    navigateToLocation(entry.file, entry.line, entry.column, false);
  }, [navigateToLocation]);

  // Handle Solution Loading (builds full semantic dependency index + discovers tests + Git status)
  const handleLoadedSolution = useCallback(
    (sol: SolutionFile) => {
      if (!sol || !sol.projects) return;

      const now = Date.now();
      if (
        lastOpenedSolutionRef.current &&
        lastOpenedSolutionRef.current.path === sol.path &&
        now - lastOpenedSolutionRef.current.ts < 400
      ) {
        return;
      }
      lastOpenedSolutionRef.current = { path: sol.path, ts: now };

      setSolutions(prev => {
        const existingIdx = prev.findIndex(s => s.path === sol.path);
        if (existingIdx !== -1) {
          const clone = [...prev];
          clone[existingIdx] = sol;
          return clone;
        }
        return [sol, ...prev];
      });

      setCurrentSolution(sol);
      const firstProject = pickRunnableProject(sol.projects) || sol.projects[0];
      if (firstProject) {
        setSelectedProject(firstProject);
        const mappedSdk = frameworkToSdkLabel(firstProject.targetFramework);
        if (mappedSdk) setActiveSdk(mappedSdk);
      }

      // Build semantic dependency & symbol index immediately
      const semanticIndex = getOrBuildSolutionIndex(sol);
      const discoveredTests = discoverSolutionTests(sol);
      const isSample = SAMPLE_SOLUTIONS.some(s => s.path === sol.path);
      setTests(discoveredTests.length > 0 ? discoveredTests : isSample ? INITIAL_TESTS : []);
      setDiagnostics(isSample ? MOCK_DIAGNOSTICS : []);
      setReferences([]);
      setGitDiffPreview(null);
      setRunningUrl(null);
      setMissingDebuggerMessage(null);
      if (!isSample) {
        const solRoot = getSolutionDir(sol.path) || sol.path;
        let savedWorkspace: {
          openPaths?: string[];
          activePath?: string;
          breakpoints?: Breakpoint[];
        } | null = null;
        try {
          const rawWs =
            localStorage.getItem('sharpforge.workspaceBySolution') ??
            localStorage.getItem('minirider.workspaceBySolution');
          const parsedWs = rawWs ? JSON.parse(rawWs) : {};
          savedWorkspace = parsedWs[sol.path] || null;
        } catch {}

        if (savedWorkspace?.breakpoints && Array.isArray(savedWorkspace.breakpoints)) {
          setBreakpoints(savedWorkspace.breakpoints);
        } else {
          setBreakpoints(prev =>
            prev.filter(b =>
              solRoot && b.filePath.replace(/\\/g, '/').startsWith(solRoot.replace(/\\/g, '/'))
            )
          );
        }
        setCallStack([]);
        setVariables([]);
        setWatchExpressions([]);

        // Record into Recent Solutions memory
        const newEntry: RecentSolutionEntry = {
          name: sol.name,
          path: sol.path,
          format: sol.format,
          lastOpened: new Date().toISOString(),
          projectCount: sol.projects.length,
          exists: true
        };
        try {
          localStorage.setItem('sharpforge.lastSolutionPath', sol.path);
        } catch {}
        setRecentSolutions(prev => {
          const next = [newEntry, ...prev.filter(r => r.path !== sol.path)].slice(0, 15);
          try {
            localStorage.setItem('sharpforge.recentSolutions', JSON.stringify(next));
          } catch {}
          return next;
        });
        window.electronAPI?.recentSolutionsAdd?.({
          name: sol.name,
          path: sol.path,
          format: sol.format,
          projectCount: sol.projects.length
        }).catch(() => {});

        // Pick restored tabs & active file if previously saved for this solution
        const allFiles = getAllSolutionFiles(sol).map(x => x.file);
        const restoredOpen = (savedWorkspace?.openPaths || [])
          .map(p => allFiles.find(f => f.path === p))
          .filter((f): f is SolutionFileItem => Boolean(f));
        const restoredActive =
          (savedWorkspace?.activePath && allFiles.find(f => f.path === savedWorkspace.activePath)) ||
          restoredOpen[0] ||
          allFiles.find(f => f.name.toLowerCase() === 'program.cs') ||
          allFiles.find(f => f.name.toLowerCase().includes('controller') && f.extension === '.cs') ||
          allFiles.find(f => f.extension === '.cs') ||
          allFiles[0] ||
          null;

        const initialTabs =
          restoredOpen.length > 0
            ? restoredOpen
            : restoredActive
            ? [restoredActive]
            : [];

        setOpenFiles(initialTabs);
        setActiveFile(restoredActive);
        if (restoredActive) {
          const startHist: HistoryEntry[] = [{ file: restoredActive, line: 1, column: 1 }];
          navHistoryRef.current = startHist;
          navIndexRef.current = 0;
          setNavHistory(startHist);
          setNavIndex(0);
          currentCursorRef.current = { line: 1, column: 1 };
          setActiveLine(1);
          setActiveColumn(1);
          setNavigationNonce(n => n + 1);
        } else {
          navHistoryRef.current = [];
          navIndexRef.current = -1;
          setNavHistory([]);
          setNavIndex(-1);
        }

        setDirtyFileIds(new Set());
        setActiveSidebarTab('explorer');
        setTerminalLogs(prev => [
          ...prev,
          `\n[Solution] Loaded ${sol.name} (${sol.format.toUpperCase()})`,
          `[Dependency Graph] ${sol.projects.length} project(s), ${allFiles.length} file(s), ${semanticIndex.typesByName.size} C# types, ${semanticIndex.diBindingsByService.size} DI bindings indexed.`,
          ...sol.projects.map(
            p =>
              `  • ${p.name} [${p.targetFramework}] — Refs: ${p.dependencies.projectReferences.length}, Packages: ${p.dependencies.packages.length}`
          )
        ]);

        refreshGitStatus(sol.path);
        showNavToast(
          `Opened ${sol.name}`,
          `${sol.projects.length} projects • ${semanticIndex.typesByName.size} C# types indexed`
        );
        return;
      }

      // Sample solution initial file selection
      const allFiles = getAllSolutionFiles(sol).map(x => x.file);
      const initialFile =
        allFiles.find(f => f.name.toLowerCase() === 'program.cs') ||
        allFiles.find(f => f.name.toLowerCase().includes('controller') && f.extension === '.cs') ||
        allFiles.find(f => f.extension === '.cs') ||
        allFiles[0] ||
        null;

      if (initialFile) {
        setOpenFiles([initialFile]);
        setActiveFile(initialFile);
        const startHist: HistoryEntry[] = [{ file: initialFile, line: 1, column: 1 }];
        navHistoryRef.current = startHist;
        navIndexRef.current = 0;
        setNavHistory(startHist);
        setNavIndex(0);
        currentCursorRef.current = { line: 1, column: 1 };
        setActiveLine(1);
        setActiveColumn(1);
        setNavigationNonce(n => n + 1);
      } else {
        setOpenFiles([]);
        setActiveFile(null);
        navHistoryRef.current = [];
        navIndexRef.current = -1;
        setNavHistory([]);
        setNavIndex(-1);
      }

      setDirtyFileIds(new Set());
      setActiveSidebarTab('explorer');
      setTerminalLogs(prev => [
        ...prev,
        `\n[Solution] Loaded ${sol.name} (${sol.format.toUpperCase()})`,
        `[Dependency Graph] ${sol.projects.length} project(s), ${allFiles.length} file(s), ${semanticIndex.typesByName.size} C# types, ${semanticIndex.diBindingsByService.size} DI bindings indexed.`,
        ...sol.projects.map(
          p =>
            `  • ${p.name} [${p.targetFramework}] — Refs: ${p.dependencies.projectReferences.length}, Packages: ${p.dependencies.packages.length}`
        )
      ]);

      refreshGitStatus(sol.path);
      showNavToast(
        `Opened ${sol.name}`,
        `${sol.projects.length} projects • ${semanticIndex.typesByName.size} C# types indexed`
      );
    },
    [refreshGitStatus, showNavToast]
  );

  // Persist open tabs, active file & breakpoints per disk solution so restarts restore your exact context
  useEffect(() => {
    const isDisk = currentSolution.path.startsWith('/') && !SAMPLE_SOLUTIONS.some(s => s.path === currentSolution.path);
    if (!isDisk) return;
    try {
      const rawWs =
        localStorage.getItem('sharpforge.workspaceBySolution') ??
        localStorage.getItem('minirider.workspaceBySolution');
      const map = rawWs ? JSON.parse(rawWs) : {};
      map[currentSolution.path] = {
        openPaths: openFiles.filter(f => !f.isDecompiled).map(f => f.path),
        activePath: activeFile && !activeFile.isDecompiled ? activeFile.path : undefined,
        breakpoints
      };
      localStorage.setItem('sharpforge.workspaceBySolution', JSON.stringify(map));
    } catch {}
  }, [activeFile, breakpoints, currentSolution.path, openFiles]);

  const handleOpenRecentSolution = useCallback(
    async (entry: RecentSolutionEntry) => {
      const alreadyLoaded = solutions.find(s => s.path === entry.path);
      if (alreadyLoaded) {
        handleLoadedSolution(alreadyLoaded);
        return;
      }

      if (window.electronAPI?.loadSolution && entry.path.startsWith('/')) {
        try {
          const loaded = await window.electronAPI.loadSolution(entry.path);
          if (loaded) {
            handleLoadedSolution(loaded);
          }
          return;
        } catch (err: any) {
          showNavToast(
            'Solution Not Found on Disk',
            `${entry.name} could not be opened (${err?.message || 'missing'})`
          );
          if (window.electronAPI?.recentSolutionsList) {
            const refreshed = await window.electronAPI.recentSolutionsList();
            setRecentSolutions(refreshed);
          }
          return;
        }
      }

      showNavToast('Desktop App Required', 'Reopening local .sln paths requires SharpForge.app');
    },
    [handleLoadedSolution, showNavToast, solutions]
  );

  const handleRemoveRecentSolution = useCallback(async (solutionPath: string) => {
    if (window.electronAPI?.recentSolutionsRemove) {
      const updated = await window.electronAPI.recentSolutionsRemove(solutionPath);
      setRecentSolutions(updated);
      try {
        localStorage.setItem('sharpforge.recentSolutions', JSON.stringify(updated));
      } catch {}
      return;
    }
    setRecentSolutions(prev => {
      const next = prev.filter(r => r.path !== solutionPath);
      try {
        localStorage.setItem('sharpforge.recentSolutions', JSON.stringify(next));
      } catch {}
      return next;
    });
  }, []);

  const handleClearRecentSolutions = useCallback(async () => {
    if (window.electronAPI?.recentSolutionsClear) {
      await window.electronAPI.recentSolutionsClear();
    }
    setRecentSolutions([]);
    try {
      localStorage.removeItem('sharpforge.recentSolutions');
      localStorage.removeItem('sharpforge.lastSolutionPath');
      localStorage.removeItem('minirider.recentSolutions');
      localStorage.removeItem('minirider.lastSolutionPath');
    } catch {}
  }, []);

  // Restore NuGet & Refresh full MSBuild Dependency Graph
  const handleRestoreDependencies = useCallback(async () => {
    if (!isRealDiskSolution || !window.electronAPI?.restoreSolution) {
      const idx = getOrBuildSolutionIndex(currentSolution);
      showNavToast('Symbol & Dependency Index Refreshed', `${idx.typesByName.size} C# types indexed`);
      return;
    }

    setIsRestoringDeps(true);
    setTerminalLogs(prev => [...prev, `\n> dotnet restore "${currentSolution.path}"`]);
    try {
      const res = await window.electronAPI.restoreSolution(currentSolution.path);
      const lines = `${res.stdout}\n${res.stderr}`.split('\n').filter(Boolean);
      setTerminalLogs(prev => [...prev, ...lines].slice(-5000));
      if (res.solution) {
        handleLoadedSolution(res.solution);
      }
    } finally {
      setIsRestoringDeps(false);
    }
  }, [currentSolution, handleLoadedSolution, isRealDiskSolution, showNavToast]);

  // Switch between already-loaded solutions
  const handleSelectSolution = useCallback(
    (sol: SolutionFile) => {
      handleLoadedSolution(sol);
    },
    [handleLoadedSolution]
  );

  // Open .sln / .slnx Dialog
  const handleOpenSolutionFile = useCallback(async () => {
    if (window.electronAPI?.openSolutionDialog) {
      try {
        const result = await window.electronAPI.openSolutionDialog();
        if (result) {
          handleLoadedSolution(result);
        }
      } catch (err: any) {
        setTerminalLogs(prev => [...prev, `[Error] Failed to open solution: ${err?.message || err}`]);
        showNavToast('Failed to Open Solution', err?.message || 'Check ~/sharpforge-logs/error.log');
      }
      return;
    }

    slnInputRef.current?.click();
  }, [handleLoadedSolution, showNavToast]);

  // Open Folder (auto-discovers .sln or all .csproj files)
  const handleOpenFolder = useCallback(async () => {
    if (window.electronAPI?.openFolderDialog) {
      try {
        const result = await window.electronAPI.openFolderDialog();
        if (result) {
          handleLoadedSolution(result);
        }
      } catch (err: any) {
        setTerminalLogs(prev => [...prev, `[Error] Failed to open folder: ${err?.message || err}`]);
        showNavToast('Failed to Open Folder', err?.message || 'Could not read directory');
      }
      return;
    }
    folderInputRef.current?.click();
  }, [handleLoadedSolution, showNavToast]);

  const handleBrowserSlnChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;

    try {
      const parsed = await parseBrowserSolutionFile(file);
      handleLoadedSolution(parsed);
      setTerminalLogs(prev => [
        ...prev,
        `[Browser Mode] Parsed ${file.name}. Use the "Folder" button in the toolbar to load all .cs & .csproj files in web preview, or launch SharpForge.app on macOS for full .NET SDK execution.`
      ]);
      showNavToast('Browser Preview Limit', 'Click "Folder" button to load all .cs source files');
    } catch (err: any) {
      showNavToast('Error Parsing Solution', err?.message || 'Invalid .sln file');
    }
  };

  const handleBrowserFolderChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;

    try {
      const parsed = await parseBrowserDirectoryFiles(files);
      e.target.value = '';
      if (parsed) {
        handleLoadedSolution(parsed);
      }
    } catch (err: any) {
      e.target.value = '';
      showNavToast('Error Loading Folder', err?.message || 'Could not read folder');
    }
  };

  // File Management, Creation, Deletion & Save
  const handleSelectFile = useCallback(
    (file: SolutionFileItem) => {
      if (file.isDirectory) return;
      if (activeFile?.id === file.id) return;
      navigateToLocation(file, 1, 1, true);
    },
    [activeFile?.id, navigateToLocation]
  );

  const handleCloseFile = useCallback(
    (file: SolutionFileItem) => {
      setOpenFiles(prev => {
        const remaining = prev.filter(f => f.id !== file.id);
        if (activeFile?.id === file.id) {
          const next = remaining[remaining.length - 1] || null;
          setActiveFile(next);
        }
        return remaining;
      });
    },
    [activeFile?.id]
  );

  const handleContentChange = useCallback((file: SolutionFileItem, newContent: string) => {
    file.content = newContent;
    setDirtyFileIds(prev => {
      if (prev.has(file.id)) return prev;
      const next = new Set(prev);
      next.add(file.id);
      return next;
    });
  }, []);

  const handleSaveFile = useCallback(
    async (targetFile?: SolutionFileItem | null) => {
      const file = targetFile || activeFile;
      if (!file) return;

      if (window.electronAPI?.saveFile && file.path.startsWith('/')) {
        const res = await window.electronAPI.saveFile(file.path, file.content || '');
        if (!res.success && res.error !== 'Non-disk virtual file') {
          showNavToast('Save Failed', res.error || 'Could not write file');
          return;
        }
      }

      setDirtyFileIds(prev => {
        const next = new Set(prev);
        next.delete(file.id);
        return next;
      });
      refreshGitStatus();
      showNavToast('Saved File', `${file.name} (${activeSdk})`);

      // Run background MSBuild / Roslyn compiler check on real C# projects when saving .cs files
      if (
        isRealDiskSolution &&
        file.extension === '.cs' &&
        window.electronAPI?.checkProject
      ) {
        const target = selectedProject?.path?.endsWith('.csproj')
          ? selectedProject.path
          : currentSolution.path;
        window.electronAPI.checkProject(target).then(checkRes => {
          const lines = `${checkRes.stdout}\n${checkRes.stderr}`.split('\n').filter(Boolean);
          setDiagnostics(parseMsBuildDiagnostics(lines, getSolutionDir(target)));
        }).catch(() => {});
      }
    },
    [activeFile, activeSdk, currentSolution.path, isRealDiskSolution, refreshGitStatus, selectedProject?.path, showNavToast]
  );

  const saveAllDirtyFiles = useCallback(async () => {
    if (!window.electronAPI?.saveFile || dirtyFileIds.size === 0) return;
    const all = getAllSolutionFiles(currentSolution);
    for (const entry of all) {
      if (dirtyFileIds.has(entry.file.id) && entry.file.path.startsWith('/')) {
        await window.electronAPI.saveFile(entry.file.path, entry.file.content || '');
      }
    }
    setDirtyFileIds(new Set());
  }, [currentSolution, dirtyFileIds]);

  const handleCreateNewFile = async (rawName: string, template: CSharpTemplateKind) => {
    const proj = newFileModalState.project;
    if (!proj) return;

    const folderRel = newFileModalState.folderRelativePath;
    const nsSuffix = folderRel
      ? '.' + folderRel.split('/').filter(Boolean).join('.')
      : '';
    const generated = generateCSharpTemplate(rawName, template, `${proj.name}${nsSuffix}`, activeSdk);

    const projDir = proj.path.endsWith('.csproj') || proj.path.endsWith('.fsproj')
      ? proj.path.slice(0, proj.path.lastIndexOf('/'))
      : proj.path;

    const relPath = folderRel ? `${folderRel}/${generated.fileName}` : generated.fileName;
    const fullPath = `${projDir}/${relPath}`;

    if (window.electronAPI?.createFile && fullPath.startsWith('/')) {
      const res = await window.electronAPI.createFile(fullPath, generated.content);
      if (!res.success) {
        showNavToast('Create File Failed', res.error || 'Could not write file to disk');
        return;
      }
    }

    const newItem: SolutionFileItem = {
      id: `file-${fullPath}-${Date.now()}`,
      name: generated.fileName,
      path: fullPath,
      relativePath: relPath,
      extension: generated.ext,
      isDirectory: false,
      content: generated.content
    };

    // Insert into tree under target folder if found, else project root
    if (folderRel) {
      const insertIntoFolder = (items: SolutionFileItem[]): boolean => {
        for (const it of items) {
          if (it.isDirectory && it.relativePath === folderRel) {
            it.children = [...(it.children || []), newItem];
            return true;
          }
          if (it.children && insertIntoFolder(it.children)) return true;
        }
        return false;
      };
      if (!insertIntoFolder(proj.files)) {
        proj.files.push(newItem);
      }
    } else {
      proj.files.push(newItem);
    }

    setSolutions(prev => [...prev]);
    navigateToLocation(newItem, 1, 1, true);
    refreshGitStatus();
    showNavToast('Created File', relPath);
  };

  const handleDeleteFile = async (file: SolutionFileItem) => {
    if (window.electronAPI?.deleteFile && file.path.startsWith('/') && !file.path.startsWith('/Users/developer/')) {
      await window.electronAPI.deleteFile(file.path);
    }
    handleCloseFile(file);
    const removeFromTree = (items: SolutionFileItem[]): SolutionFileItem[] =>
      items
        .filter(i => i.id !== file.id && i.path !== file.path)
        .map(i => (i.children ? { ...i, children: removeFromTree(i.children) } : i));

    currentSolution.projects.forEach(p => {
      p.files = removeFromTree(p.files);
    });
    setSolutions(prev => [...prev]);
    refreshGitStatus();
    showNavToast('Removed File', file.name);
  };

  // Breakpoints (syncs live with netcoredbg when debugging real projects)
  const handleToggleBreakpoint = useCallback(
    (filePath: string, line: number) => {
      setBreakpoints(prev => {
        const existing = prev.find(b => b.filePath === filePath && b.line === line);
        const next = existing
          ? prev.filter(b => !(b.filePath === filePath && b.line === line))
          : [...prev, { id: `bp-${Date.now()}`, filePath, line, enabled: true }];

        if (isRealDiskSolution && isDebugging && window.electronAPI?.debugSetBreakpoints) {
          const linesForFile = next
            .filter(b => b.filePath === filePath && b.enabled)
            .map(b => b.line);
          window.electronAPI.debugSetBreakpoints(filePath, linesForFile).catch(() => {});
        }
        return next;
      });
    },
    [isDebugging, isRealDiskSolution]
  );

  const handleToggleBreakpointEnabled = (id: string) => {
    setBreakpoints(prev => {
      const next = prev.map(b => (b.id === id ? { ...b, enabled: !b.enabled } : b));
      const changed = next.find(b => b.id === id);
      if (changed && isRealDiskSolution && isDebugging && window.electronAPI?.debugSetBreakpoints) {
        const linesForFile = next
          .filter(b => b.filePath === changed.filePath && b.enabled)
          .map(b => b.line);
        window.electronAPI.debugSetBreakpoints(changed.filePath, linesForFile).catch(() => {});
      }
      return next;
    });
  };

  const handleRemoveBreakpoint = (id: string) => {
    setBreakpoints(prev => {
      const removed = prev.find(b => b.id === id);
      const next = prev.filter(b => b.id !== id);
      if (removed && isRealDiskSolution && isDebugging && window.electronAPI?.debugSetBreakpoints) {
        const linesForFile = next
          .filter(b => b.filePath === removed.filePath && b.enabled)
          .map(b => b.line);
        window.electronAPI.debugSetBreakpoints(removed.filePath, linesForFile).catch(() => {});
      }
      return next;
    });
  };

  const openFileAtLocation = useCallback(
    async (targetPath: string, line = 1, column = 1) => {
      if (!targetPath) return;
      let file = findFileByPath(targetPath);
      if (!file) {
        for (const sol of solutions) {
          file = findFileByPath(targetPath, sol);
          if (file) break;
        }
      }
      if (!file && targetPath.startsWith('/') && window.electronAPI?.readFile) {
        const res = await window.electronAPI.readFile(targetPath);
        if (res.success && typeof res.content === 'string') {
          const name = targetPath.split('/').pop() || targetPath;
          const dotIdx = name.lastIndexOf('.');
          file = {
            id: `disk-${targetPath}`,
            name,
            path: targetPath,
            relativePath: name,
            extension: dotIdx !== -1 ? name.slice(dotIdx).toLowerCase() : '.cs',
            isDirectory: false,
            content: res.content
          };
        }
      }
      if (file) {
        navigateToLocation(file, line, column, true);
      } else {
        showNavToast('File Not Found', targetPath.split('/').pop() || targetPath);
      }
    },
    [findFileByPath, navigateToLocation, showNavToast, solutions]
  );

  const handleNavigateToBreakpoint = useCallback(
    (bp: Breakpoint) => {
      openFileAtLocation(bp.filePath, bp.line, 1);
    },
    [openFileAtLocation]
  );

  // Finder Integration
  const handleRevealInFinder = (path: string) => {
    setFinderPath(path);
    if (window.electronAPI) {
      window.electronAPI.revealInFinder(path);
    }
  };

  // Build Operation (Cmd+Shift+B) — Real MSBuild diagnostics in Electron!
  const handleBuild = useCallback(async () => {
    await saveAllDirtyFiles();
    setIsBuilding(true);
    setBottomPanelTab('build');
    setIsBottomPanelOpen(true);

    const timestamp = new Date().toLocaleTimeString();
    const tfm = selectedProject?.targetFramework || sdkLabelToTfm(activeSdk);

    if (isRealDiskSolution && window.electronAPI?.runCommand) {
      setBuildLogs([
        `------ Build started: Solution: ${currentSolution.name}, SDK: ${activeSdk}, Configuration: ${buildConfig} ------`,
        `[${timestamp}] > dotnet build "${currentSolution.path}" -c ${buildConfig}`
      ]);
      const res = await window.electronAPI.runCommand(
        `dotnet build "${currentSolution.path}" -c ${buildConfig}`,
        getSolutionDir(currentSolution.path)
      );
      const outputLines = `${res.stdout}\n${res.stderr}`.split('\n').filter(Boolean);
      const parsedDiags = parseMsBuildDiagnostics(outputLines, getSolutionDir(currentSolution.path));
      setDiagnostics(parsedDiags);

      setBuildLogs(prev => [
        ...prev,
        ...outputLines,
        res.success
          ? `[${new Date().toLocaleTimeString()}] Build succeeded (${parsedDiags.length} warning(s)).`
          : `[${new Date().toLocaleTimeString()}] Build failed with exit code ${res.code} (${parsedDiags.filter(d => d.severity === 'error').length} error(s)).`
      ]);
      setIsBuilding(false);
      return;
    }

    setBuildLogs([
      `------ Build started: Project: ${selectedProject.name}, SDK: ${activeSdk}, Configuration: ${buildConfig} Any CPU ------`,
      `[${timestamp}] Restoring NuGet dependencies for ${currentSolution.name}...`,
      `[${timestamp}] Targeting ${tfm} (${activeSdk}) — All packages compatible.`,
      `[${timestamp}] Compiling C# source files using Roslyn compiler (csc.dll)...`,
      `[${timestamp}] ${selectedProject.name} -> bin/${buildConfig}/${tfm}/${selectedProject.name}.dll`,
      `[${timestamp}] ========== Build: ${currentSolution.projects.length} succeeded, 0 failed, 0 skipped ==========`
    ]);

    setTimeout(() => {
      setIsBuilding(false);
      setBuildLogs(prev => [
        ...prev,
        `Build completed successfully at ${new Date().toLocaleTimeString()}. 0 Errors, 0 Warnings.`
      ]);
    }, 650);
  }, [activeSdk, buildConfig, currentSolution, isRealDiskSolution, saveAllDirtyFiles, selectedProject]);

  const refreshActivePorts = useCallback(async () => {
    if (!window.electronAPI?.portsList) return [];
    setIsScanningPorts(true);
    try {
      const res = await window.electronAPI.portsList();
      if (res.success && Array.isArray(res.ports)) {
        setActivePorts(res.ports);
        return res.ports;
      }
    } catch {
      // Ignore scan failure
    } finally {
      setIsScanningPorts(false);
    }
    return [];
  }, []);

  const handleKillPortProcess = useCallback(
    async (options: { pid?: number; port?: number; force?: boolean }) => {
      if (!window.electronAPI?.portsKill) {
        showNavToast('Desktop App Required', 'Killing OS port services requires SharpForge.app');
        return;
      }
      const res = await window.electronAPI.portsKill(options);
      await refreshActivePorts();
      if (res.success) {
        const desc = options.port ? `port :${options.port}` : `PID ${options.pid}`;
        showNavToast('Service Stopped', `Freed ${desc} (killed PID ${res.killedPids.join(', ')})`);
      } else {
        showNavToast('Could Not Stop Service', res.error || 'No active listener found');
      }
    },
    [refreshActivePorts, showNavToast]
  );

  const handleApplyPortConfig = useCallback(
    (config: ProjectPortConfig | null) => {
      if (!selectedProject) return;
      setPortOverrides(prev => {
        const next = { ...prev };
        if (config && config.port) {
          next[selectedProject.path] = config;
        } else {
          delete next[selectedProject.path];
        }
        try {
          localStorage.setItem('sharpforge.portOverrides', JSON.stringify(next));
        } catch {}
        return next;
      });
      if (config && config.port) {
        showNavToast('Port Override Applied', `Next Run/Debug will use ${buildUrlForPort(config.port, config.protocol)}`);
      } else {
        const baseInfo = resolveProjectPortInfo(selectedProject);
        showNavToast('Reset to Default Port', `Using ${baseInfo.defaultUrl} (${baseInfo.source})`);
      }
    },
    [selectedProject, showNavToast]
  );

  const handleSavePortToLaunchSettings = useCallback(
    async (port: number, protocol: 'http' | 'https') => {
      if (!selectedProject) return;
      const newUrl = buildUrlForPort(port, protocol);
      const projName = selectedProject.name;
      const updatedProj = { ...selectedProject };
      if (!updatedProj.launchSettings) updatedProj.launchSettings = { profiles: {} };
      if (!updatedProj.launchSettings.profiles[projName]) {
        updatedProj.launchSettings.profiles[projName] = {
          commandName: 'Project',
          dotnetRunMessages: true,
          launchBrowser: true,
          applicationUrl: newUrl,
          environmentVariables: {
            ASPNETCORE_ENVIRONMENT: 'Development'
          }
        };
      } else {
        updatedProj.launchSettings.profiles[projName] = {
          ...updatedProj.launchSettings.profiles[projName],
          applicationUrl: newUrl
        };
      }

      const jsonText = JSON.stringify(updatedProj.launchSettings, null, 2);
      const launchFile = updatedProj.files
        .find(f => f.name === 'Properties')?.children
        ?.find(f => f.name.toLowerCase() === 'launchsettings.json');

      if (launchFile) {
        launchFile.content = jsonText;
        if (window.electronAPI?.saveFile && launchFile.path.startsWith('/')) {
          await window.electronAPI.saveFile(launchFile.path, jsonText);
        }
      } else if (selectedProject.path.endsWith('.csproj') && window.electronAPI?.createFile) {
        const projDir = selectedProject.path.slice(0, selectedProject.path.lastIndexOf('/'));
        const launchPath = `${projDir}/Properties/launchSettings.json`;
        await window.electronAPI.createFile(launchPath, jsonText);
      }

      setSolutions(prev =>
        prev.map(s => ({
          ...s,
          projects: s.projects.map(p => (p.id === updatedProj.id ? updatedProj : p))
        }))
      );
      setSelectedProject(updatedProj);
      showNavToast('Saved to launchSettings.json', `applicationUrl set to ${newUrl}`);
    },
    [selectedProject, showNavToast]
  );

  // Run Project (Cmd+R) — Real streaming dotnet run with launchSettings.json / appsettings.json / custom port env injection!
  const handleRun = useCallback(
    async (skipPortConflictCheck = false, overridePortConfig?: ProjectPortConfig | null) => {
      await saveAllDirtyFiles();
      if (activeProcessIdRef.current && window.electronAPI?.stopProcess) {
        await window.electronAPI.stopProcess(activeProcessIdRef.current);
        activeProcessIdRef.current = null;
      }
      if (window.electronAPI?.debugStop && isDebugging) {
        await window.electronAPI.debugStop();
      }

      let runTarget = selectedProject;
      if (isRealDiskSolution && (runTarget.projectType === 'classlib' || runTarget.projectType === 'test')) {
        const candidate = pickRunnableProject(currentSolution.projects);
        if (candidate && candidate.id !== runTarget.id && candidate.projectType !== 'classlib') {
          runTarget = candidate;
          setSelectedProject(candidate);
          showNavToast('Switched Startup Project', `Running executable ${candidate.name}`);
        }
      }

      const activeOverride =
        overridePortConfig !== undefined
          ? overridePortConfig
          : portOverrides[runTarget.path] || null;
      const launchConfig = resolveEffectiveLaunchConfig(runTarget, activeOverride);
      const { env: launchEnv, url: launchUrl, port: launchPort } = launchConfig;

      // Pre-flight OS port conflict check so user doesn't silently fail with "address already in use"
      if (!skipPortConflictCheck && isRealDiskSolution && launchPort && window.electronAPI?.portsCheck) {
        const conflictCheck = await window.electronAPI.portsCheck(launchPort);
        if (conflictCheck.inUse) {
          await refreshActivePorts();
          setPortModalState({ isOpen: true, pendingLaunchMode: 'run' });
          return;
        }
      }

      setRunningUrl(launchUrl);
      setMissingDebuggerMessage(null);
      setIsRunning(true);
      setIsDebugging(false);
      setIsPaused(false);
      setPausedLocation(null);
      setBottomPanelTab('terminal');
      setIsBottomPanelOpen(true);

      if (isRealDiskSolution && window.electronAPI?.spawnProcess && runTarget.path.endsWith('.csproj')) {
        const projDir = runTarget.path.slice(0, runTarget.path.lastIndexOf('/'));
        const multiTfmFlag =
          runTarget.targetFrameworks && runTarget.targetFrameworks.length > 1 && runTarget.targetFramework
            ? ` -f "${runTarget.targetFramework}"`
            : '';
        const runCmd = `dotnet run --project "${runTarget.path}" -c ${buildConfig}${multiTfmFlag}`;
        setTerminalLogs(prev => [
          ...prev,
          `\n> ${runCmd} (Port: ${launchPort || 'Auto'}, Source: ${launchConfig.source}, ASPNETCORE_URLS=${launchEnv.ASPNETCORE_URLS || launchUrl || 'default'})`
        ]);
        const spawned = await window.electronAPI.spawnProcess(runCmd, projDir, launchEnv);
        if (spawned.success && spawned.processId) {
          activeProcessIdRef.current = spawned.processId;
          setTimeout(() => refreshActivePorts(), 1800);
        } else {
          setIsRunning(false);
          setRunningUrl(null);
          setTerminalLogs(prev => [...prev, `[Error] ${spawned.error || 'Could not start process'}`]);
        }
        return;
      }

      if (!isSampleSolution && !window.electronAPI?.spawnProcess) {
        setIsRunning(false);
        setRunningUrl(null);
        setTerminalLogs(prev => [
          ...prev,
          `[Browser Mode] Cannot execute '${runTarget.name}' inside a web browser. Launch SharpForge.app on macOS (built via ./setup.sh) to run real .NET solutions.`
        ]);
        showNavToast('Desktop App Required', 'Run SharpForge.app to execute real .NET solutions');
        return;
      }

      const fallbackUrl = launchUrl || 'http://localhost:5124';
      setRunningUrl(fallbackUrl);
      setTerminalLogs(prev => [
        ...prev,
        `\n> dotnet run --project ${runTarget.name} --framework ${runTarget.targetFramework}`,
        `Building project ${runTarget.name} (${activeSdk})...`,
        `info: Microsoft.Hosting.Lifetime[14]`,
        `      Now listening on: ${fallbackUrl}`,
        `info: Microsoft.Hosting.Lifetime[0]`,
        `      Application started. Press Stop to shut down.`,
        `info: Microsoft.Hosting.Lifetime[0]`,
        `      Hosting environment: Development`
      ]);
    },
    [
      activeSdk,
      buildConfig,
      currentSolution.projects,
      isDebugging,
      isRealDiskSolution,
      isSampleSolution,
      portOverrides,
      refreshActivePorts,
      saveAllDirtyFiles,
      selectedProject,
      showNavToast
    ]
  );

  // Start Debugging (F5) — Real netcoredbg DAP session on disk solutions with custom/default port support!
  const handleDebug = useCallback(
    async (
      overrideDebuggerPath?: string,
      skipPortConflictCheck = false,
      overridePortConfig?: ProjectPortConfig | null
    ) => {
      await saveAllDirtyFiles();
      if (activeProcessIdRef.current && window.electronAPI?.stopProcess) {
        await window.electronAPI.stopProcess(activeProcessIdRef.current);
        activeProcessIdRef.current = null;
      }

      let debugTarget = selectedProject;
      if (isRealDiskSolution && (debugTarget.projectType === 'classlib' || debugTarget.projectType === 'test')) {
        const candidate = pickRunnableProject(currentSolution.projects);
        if (candidate && candidate.id !== debugTarget.id && candidate.projectType !== 'classlib') {
          debugTarget = candidate;
          setSelectedProject(candidate);
        }
      }

      const activeOverride =
        overridePortConfig !== undefined
          ? overridePortConfig
          : portOverrides[debugTarget.path] || null;
      const launchConfig = resolveEffectiveLaunchConfig(debugTarget, activeOverride);

      if (!skipPortConflictCheck && isRealDiskSolution && launchConfig.port && window.electronAPI?.portsCheck) {
        const conflictCheck = await window.electronAPI.portsCheck(launchConfig.port);
        if (conflictCheck.inUse) {
          await refreshActivePorts();
          setPortModalState({ isOpen: true, pendingLaunchMode: 'debug' });
          return;
        }
      }

      const tfm = debugTarget.targetFramework || sdkLabelToTfm(activeSdk);
      setIsDebugging(true);
      setIsRunning(false);
      setIsPaused(false);
      setPausedLocation(null);
      setCallStack([]);
      setVariables([]);
      setReturnValues([]);
      setExecutionTrace([]);
      setMissingDebuggerMessage(null);
      setDebugStepIndex(0);
      setBottomPanelTab('debug');
      setIsBottomPanelOpen(true);

      if (isRealDiskSolution && window.electronAPI?.debugStart) {
        setDebugLogs([
          `[Build] Building ${debugTarget.name} (${buildConfig}, ${tfm}) with debug symbols...`,
          `[Port] Target: ${launchConfig.url || 'Auto'} (${launchConfig.source})`,
          `[DAP] Syncing ${breakpoints.filter(b => b.enabled).length} enabled breakpoint(s) to netcoredbg...`
        ]);

        const resolvedDebuggerOverride = typeof overrideDebuggerPath === 'string' ? overrideDebuggerPath : undefined;
        const res = await window.electronAPI.debugStart({
          projectPath: debugTarget.path,
          buildConfig,
          targetFramework: tfm,
          debuggerPath: resolvedDebuggerOverride || debuggerPath,
          customPort: activeOverride?.port || undefined,
          customUrl: activeOverride?.port ? buildUrlForPort(activeOverride.port, activeOverride.protocol) : undefined,
          breakpoints: breakpoints.map(b => ({ filePath: b.filePath, line: b.line, enabled: b.enabled }))
        });

        if (!res.success) {
          let errorPreview: string[] = [];
          if (res.buildOutput) {
            const outLines = res.buildOutput.split('\n').filter(Boolean);
            setDiagnostics(parseMsBuildDiagnostics(outLines, getSolutionDir(debugTarget.path)));
            setBuildLogs(outLines);
            errorPreview = outLines.filter(l => /error\s+[A-Z0-9]+:/i.test(l) || /\berror\b/i.test(l)).slice(0, 12);
          }
          if (res.missingDebugger) {
            setMissingDebuggerMessage(res.error || 'netcoredbg binary not found');
          }
          setDebugLogs(prev => [
            ...prev,
            ...errorPreview,
            `[ERROR] ${res.error || 'Failed to start debug session'}`
          ]);
          setBottomPanelTab('debug');
          setIsBottomPanelOpen(true);
          setIsDebugging(false);
          return;
        }

        if (res.applicationUrl) {
          setRunningUrl(res.applicationUrl.split(';')[0].trim());
        } else if (launchConfig.url) {
          setRunningUrl(launchConfig.url);
        }
        setDebugLogs(prev => [
          ...prev,
          `[DAP] netcoredbg attached (${res.netcoredbgPath})`,
          `[DAP] Launched ${res.dllPath}`,
          ...(res.applicationUrl ? [`[Host] Configured URL(s): ${res.applicationUrl}`] : [])
        ]);
        setTimeout(() => refreshActivePorts(), 1800);
        return;
      }

      if (!isSampleSolution) {
        setIsDebugging(false);
        setBottomPanelTab('debug');
        setIsBottomPanelOpen(true);
        setDebugLogs([
          `[ERROR] Real .NET debugging requires the native SharpForge.app desktop runtime with .NET SDK and netcoredbg.`,
          `Build SharpForge.app via './setup.sh' and open '${currentSolution.name}' inside the desktop app.`
        ]);
        showNavToast('Desktop App Required', 'Debug real .sln projects inside SharpForge.app');
        return;
      }

      // Virtual sample solution fallback (WeatherTracker demo only)
      const url = launchConfig.url || 'http://localhost:5124';
      setRunningUrl(url);
      setDebugLogs([
        `[DAP] Starting sample netcoredbg session for ${debugTarget.name} (${activeSdk})...`,
        `[DAP] Syncing ${breakpoints.length} breakpoint(s)...`,
        `[API] ASP.NET Core Kestrel listening on ${url}`,
        `[API] Use the Sample API Trigger bar above to simulate hitting UsersController.cs:24.`
      ]);

      if (usersCtrlFile && currentSolution.name === SAMPLE_SOLUTIONS[0].name) {
        navigateToLocation(usersCtrlFile, 24, 1, true);
      }
    },
    [
      activeSdk,
      breakpoints,
      buildConfig,
      currentSolution.name,
      currentSolution.projects,
      debuggerPath,
      isRealDiskSolution,
      isSampleSolution,
      navigateToLocation,
      portOverrides,
      refreshActivePorts,
      saveAllDirtyFiles,
      selectedProject,
      showNavToast,
      usersCtrlFile
    ]
  );

  const handleLaunchAfterPortResolve = useCallback(
    async (mode: 'run' | 'debug', overrideCfg: ProjectPortConfig | null) => {
      if (mode === 'run') {
        await handleRun(true, overrideCfg);
      } else {
        await handleDebug(undefined, true, overrideCfg);
      }
    },
    [handleDebug, handleRun]
  );

  const handleInstallNetcoredbg = useCallback(async () => {
    if (!window.electronAPI?.installNetcoredbg) return;
    setMissingDebuggerMessage('Downloading open-source netcoredbg for macOS...');
    setDebugLogs(prev => [...prev, `[Setup] Downloading Samsung netcoredbg (MIT) to ~/.sharpforge/netcoredbg...`]);
    const res = await window.electronAPI.installNetcoredbg();
    if (res.success && res.path) {
      setDebuggerPath(res.path);
      setMissingDebuggerMessage(null);
      setDebugLogs(prev => [...prev, `[Setup] netcoredbg installed at ${res.path}. Retrying debug launch...`]);
      showNavToast('netcoredbg Installed', res.path);
      handleDebug(res.path);
    } else {
      setMissingDebuggerMessage(`Auto-install failed: ${res.error || 'Try: brew install samsung/netcoredbg/netcoredbg'}`);
      setDebugLogs(prev => [...prev, `[ERROR] ${res.error || 'Could not download netcoredbg'}`]);
    }
  }, [handleDebug, showNavToast]);

  const handleSendTestApiRequest = (endpoint: string) => {
    if (!isDebugging) handleDebug();

    setDebugLogs(prev => [
      ...prev,
      `\n[HTTP] Incoming request: GET ${endpoint} from 127.0.0.1:54321`,
      `[API] Routing to UsersController.Get(int id = 42)`,
      `[DAP] Breakpoint hit at UsersController.cs:24 (Thread 1)`
    ]);

    setIsPaused(true);
    setDebugStepIndex(1);
    if (usersCtrlFile) {
      setPausedLocation({ filePath: usersCtrlFile.path, line: 24 });
      navigateToLocation(usersCtrlFile, 24, 9, true);
    }

    setCallStack([
      { id: 1, name: 'UsersController.Get(int id = 42)', file: usersCtrlFile?.path || 'UsersController.cs', line: 24, column: 9 },
      { id: 2, name: 'Microsoft.AspNetCore.Mvc.Infrastructure.ActionMethodExecutor.SyncActionResultExecutor.Execute(...)', file: 'Microsoft.AspNetCore.Mvc.Core.dll', line: 142, column: 1 }
    ]);
    setSelectedFrameId(1);

    const sampleVars: VariableItem[] = [
      { name: 'id', value: '42', type: 'int', scope: 'Arguments' },
      {
        name: 'this',
        value: '{WeatherTracker.Api.Controllers.UsersController}',
        type: 'UsersController',
        children: [
          { name: '_service', value: '{WeatherTracker.Core.Services.UserService}', type: 'IUserService' },
          { name: '_logger', value: '{Microsoft.Extensions.Logging.Logger<UsersController>}', type: 'ILogger' }
        ]
      },
      { name: 'user', value: 'null', type: 'WeatherTracker.Core.Models.User', scope: 'Locals' }
    ];

    const ctrlFrame: StackFrame = {
      id: 1,
      name: 'UsersController.Get(int id = 42)',
      file: usersCtrlFile?.path || 'UsersController.cs',
      line: 24,
      column: 9,
      isExternal: false,
      parameters: [{ name: 'id', value: '42', type: 'int', scope: 'Arguments' }],
      localsSnapshot: [{ name: 'user', value: 'null', type: 'User', scope: 'Locals' }]
    };

    setCallStack([
      ctrlFrame,
      {
        id: 2,
        name: 'Microsoft.AspNetCore.Mvc.Infrastructure.ActionMethodExecutor.SyncActionResultExecutor.Execute(...)',
        file: 'Microsoft.AspNetCore.Mvc.Core.dll',
        line: 142,
        column: 1,
        isExternal: true
      }
    ]);
    setSelectedFrameId(1);
    setVariables(sampleVars);
    setExecutionTrace([
      {
        id: `trace-${Date.now()}`,
        stepNumber: 1,
        functionName: ctrlFrame.name,
        shortName: formatShortFunctionName(ctrlFrame.name),
        file: ctrlFrame.file,
        line: 24,
        reason: 'breakpoint',
        timestamp: new Date().toLocaleTimeString(),
        parameters: ctrlFrame.parameters || [],
        locals: ctrlFrame.localsSnapshot || []
      }
    ]);

    setWatchExpressions([
      { id: 'w-1', expression: 'id', value: '42' },
      { id: 'w-2', expression: 'user == null', value: 'true' }
    ]);
  };

  // DAP Stepping & Execution Controls (Real netcoredbg when on disk!)
  const handleContinue = useCallback(async () => {
    if (isRealDiskSolution && window.electronAPI?.debugContinue) {
      setIsPaused(false);
      setPausedLocation(null);
      await window.electronAPI.debugContinue();
      return;
    }
    setIsPaused(false);
    setPausedLocation(null);
    setDebugStepIndex(0);
    setDebugLogs(prev => [
      ...prev,
      `[DAP] Continued execution.`,
      `[HTTP] 200 OK Response sent`
    ]);
  }, [isRealDiskSolution]);

  const handlePauseDebug = useCallback(async () => {
    if (isRealDiskSolution && window.electronAPI?.debugPause) {
      await window.electronAPI.debugPause();
    }
  }, [isRealDiskSolution]);

  const handleStepOver = useCallback(async () => {
    if (!isPaused) return;
    if (isRealDiskSolution && window.electronAPI?.debugStepOver) {
      await window.electronAPI.debugStepOver();
      return;
    }
    if (debugStepIndex === 2 && usersCtrlFile) {
      setDebugStepIndex(3);
      navigateToLocation(usersCtrlFile, 25, 9, false);
      setPausedLocation({ filePath: usersCtrlFile.path, line: 25 });
      const retEntry: ReturnValueEntry = {
        id: `ret-${Date.now()}`,
        functionName: 'UserService.GetUserById()',
        returnType: 'User',
        value: '{ Id = 42, Email = "alice@sharpforge.dev", Role = "Admin" }',
        file: userServiceFile?.path || 'UserService.cs',
        line: 23,
        timestamp: new Date().toLocaleTimeString()
      };
      setReturnValues(prev => [retEntry, ...prev]);
      setCallStack(prev =>
        prev.filter(f => f.id !== 10).map(f => (f.id === 1 ? { ...f, line: 25, returnValue: { value: retEntry.value, type: retEntry.returnType } } : f))
      );
      setSelectedFrameId(1);
      setVariables([
        { name: 'id', value: '42', type: 'int', scope: 'Arguments' },
        {
          name: 'user',
          value: '{WeatherTracker.Core.Models.User}',
          type: 'User',
          scope: 'Locals',
          children: [
            { name: 'Id', value: '42', type: 'int' },
            { name: 'Email', value: '"alice@sharpforge.dev"', type: 'string' },
            { name: 'Role', value: '"Admin"', type: 'string' }
          ]
        },
        { name: '$ReturnValue', value: retEntry.value, type: 'User', scope: 'Return Value' }
      ]);
      setDebugLogs(prev => [...prev, `[DAP] Stepped out/over to UsersController.cs:25. $ReturnValue = ${retEntry.value}`]);
    } else if (debugStepIndex === 1 && usersCtrlFile) {
      setDebugStepIndex(3);
      setPausedLocation({ filePath: usersCtrlFile.path, line: 29 });
      navigateToLocation(usersCtrlFile, 29, 9, false);
      setDebugLogs(prev => [...prev, `[DAP] Stepped over to UsersController.cs:29`]);
    } else {
      handleContinue();
    }
  }, [debugStepIndex, handleContinue, isPaused, isRealDiskSolution, navigateToLocation, userServiceFile, usersCtrlFile]);

  const handleStepInto = useCallback(async () => {
    if (!isPaused) return;
    if (isRealDiskSolution && window.electronAPI?.debugStepInto) {
      await window.electronAPI.debugStepInto();
      return;
    }
    if (debugStepIndex === 1 && userServiceFile && usersCtrlFile) {
      setDebugStepIndex(2);
      navigateToLocation(userServiceFile, 23, 9, true);
      setPausedLocation({ filePath: userServiceFile.path, line: 23 });
      const svcFrame: StackFrame = {
        id: 10,
        name: 'UserService.GetUserById(int id = 42)',
        file: userServiceFile.path,
        line: 23,
        column: 9,
        isExternal: false,
        parameters: [{ name: 'id', value: '42', type: 'int', scope: 'Arguments' }],
        localsSnapshot: [{ name: 'cachedUser', value: 'true', type: 'bool', scope: 'Locals' }]
      };
      setCallStack([
        svcFrame,
        {
          id: 1,
          name: 'UsersController.Get(int id = 42)',
          file: usersCtrlFile.path,
          line: 24,
          column: 9,
          isExternal: false,
          parameters: [{ name: 'id', value: '42', type: 'int', scope: 'Arguments' }]
        }
      ]);
      setSelectedFrameId(10);
      setExecutionTrace(prev => [
        ...prev,
        {
          id: `trace-${Date.now()}`,
          stepNumber: prev.length + 1,
          functionName: svcFrame.name,
          shortName: formatShortFunctionName(svcFrame.name),
          file: svcFrame.file,
          line: 23,
          reason: 'stepIn',
          timestamp: new Date().toLocaleTimeString(),
          parameters: svcFrame.parameters || [],
          locals: svcFrame.localsSnapshot || []
        }
      ]);
      setDebugLogs(prev => [...prev, `[DAP] Stepped into UserService.GetUserById(int id = 42)`]);
    } else {
      handleStepOver();
    }
  }, [debugStepIndex, handleStepOver, isPaused, isRealDiskSolution, navigateToLocation, userServiceFile, usersCtrlFile]);

  const handleStepOut = useCallback(async () => {
    if (!isPaused) return;
    if (isRealDiskSolution && window.electronAPI?.debugStepOut) {
      await window.electronAPI.debugStepOut();
      return;
    }
    if (debugStepIndex === 2) handleStepOver();
    else handleContinue();
  }, [debugStepIndex, handleContinue, handleStepOver, isPaused, isRealDiskSolution]);

  const handleStop = useCallback(async () => {
    if (activeProcessIdRef.current && window.electronAPI?.stopProcess) {
      await window.electronAPI.stopProcess(activeProcessIdRef.current);
      activeProcessIdRef.current = null;
    }
    if (window.electronAPI?.debugStop) {
      await window.electronAPI.debugStop();
    }
    setIsRunning(false);
    setIsDebugging(false);
    setIsPaused(false);
    setPausedLocation(null);
    setRunningUrl(null);
    setDebugLogs(prev => [...prev, `[DAP] Session terminated.`]);
    setTerminalLogs(prev => [...prev, `Process stopped.`]);
  }, []);

  const handleExpandVariable = useCallback(
    async (varPath: string, variablesReference: number) => {
      if (!window.electronAPI?.debugVariables) return;
      const children = await window.electronAPI.debugVariables(variablesReference);
      const segments = varPath.split('.');
      const attach = (list: VariableItem[], depth: number): VariableItem[] =>
        list.map((item, idx) => {
          const key = depth === 0 ? `${item.name}-${idx}` : `${item.name}.${idx}`;
          const targetKey = depth === 0 ? segments[0] : `${segments[depth]}.${segments[depth + 1]}`;
          if (item.variablesReference === variablesReference || key === targetKey) {
            return { ...item, children };
          }
          if (item.children) {
            return { ...item, children: attach(item.children, depth + 2) };
          }
          return item;
        });
      setVariables(prev => attach(prev, 0));
    },
    []
  );

  // Evaluate C# Expression / Variable in Active Debug Frame (Hover, Watch, Modal)
  const handleEvaluateDebugExpression = useCallback(
    async (
      expression: string,
      context: 'hover' | 'watch' | 'repl' = 'hover'
    ): Promise<EvaluatedDebugValue> => {
      const clean = (expression || '').trim();
      if (!isDebugging || !isPaused || !clean) {
        return { success: false, expression: clean, result: '' };
      }

      if (isRealDiskSolution && window.electronAPI?.debugEvaluate) {
        const res = await window.electronAPI.debugEvaluate(clean, selectedFrameId, context);
        if (res && res.success) {
          return {
            success: true,
            expression: clean,
            result: res.result,
            type: res.type,
            variablesReference: res.variablesReference
          };
        }
        return {
          success: false,
          expression: clean,
          result: res?.result || `Could not evaluate '${clean}'`
        };
      }

      return evaluateSampleExpression(clean, variables);
    },
    [isDebugging, isPaused, isRealDiskSolution, selectedFrameId, variables]
  );

  const handleExpandDebugVariables = useCallback(async (variablesReference: number): Promise<VariableItem[]> => {
    if (!variablesReference || !window.electronAPI?.debugVariables) return [];
    return await window.electronAPI.debugVariables(variablesReference);
  }, []);

  const handleAddWatchExpression = useCallback(
    async (expr: string) => {
      const clean = (expr || '').trim();
      if (!clean) return;
      const evalRes = await handleEvaluateDebugExpression(clean, 'watch');
      const displayVal = evalRes.success ? evalRes.result : evalRes.result || '(pending pause)';
      setWatchExpressions(prev => {
        const existingIdx = prev.findIndex(w => w.expression === clean);
        if (existingIdx !== -1) {
          const clone = [...prev];
          clone[existingIdx] = { ...clone[existingIdx], value: displayVal };
          return clone;
        }
        return [...prev, { id: `w-${Date.now()}`, expression: clean, value: displayVal }];
      });
      showNavToast('Added to Watches', `${clean} = ${displayVal}`);
    },
    [handleEvaluateDebugExpression, showNavToast]
  );

  const handleSetDebugVariableValue = useCallback(
    async (payload: {
      expression: string;
      newValue: string;
      variablesReference?: number;
      name?: string;
    }): Promise<{ success: boolean; value?: string; error?: string }> => {
      const expr = (payload.expression || payload.name || '').trim();
      if (!isDebugging || !isPaused || !expr) {
        return { success: false, error: 'Debugger must be paused at a breakpoint to modify runtime values.' };
      }

      if (isRealDiskSolution && window.electronAPI?.debugSetVariable) {
        const matchedLocal =
          !payload.variablesReference && !expr.includes('.')
            ? variables.find(v => v.name === expr)
            : undefined;

        const res = await window.electronAPI.debugSetVariable({
          variablesReference: payload.variablesReference ?? matchedLocal?.parentVariablesReference,
          name: payload.name ?? matchedLocal?.name,
          expression: expr,
          value: payload.newValue,
          frameId: selectedFrameId
        });

        if (res.success) {
          const updatedVal = res.value ?? payload.newValue;
          if (window.electronAPI.debugFrameVariables) {
            const refreshedVars = await window.electronAPI.debugFrameVariables(selectedFrameId);
            setVariables(refreshedVars);
          }
          // Re-evaluate all watches after mutation
          if (window.electronAPI.debugEvaluate) {
            setWatchExpressions(prev => {
              Promise.all(
                prev.map(async w => {
                  const r = await window.electronAPI!.debugEvaluate!(w.expression, selectedFrameId, 'watch');
                  return r.success ? { ...w, value: r.result } : w;
                })
              ).then(updatedWatches => setWatchExpressions(updatedWatches));
              return prev;
            });
          }
          setDebugLogs(prev => [...prev, `[DAP] Runtime value changed: ${expr} = ${updatedVal}`]);
          showNavToast('Runtime Value Changed', `${expr} = ${updatedVal}`);
          return { success: true, value: updatedVal };
        }
        setDebugLogs(prev => [...prev, `[ERROR] Could not set ${expr}: ${res.error || 'Operation rejected by runtime'}`]);
        return { success: false, error: res.error || 'Could not set value' };
      }

      // Sample solution runtime variable mutation
      const { updated, applied } = updateSampleVariableValue(variables, expr, payload.newValue);
      if (applied) {
        setVariables(updated);
        setWatchExpressions(prev =>
          prev.map(w => {
            const r = evaluateSampleExpression(w.expression, updated);
            return r.success ? { ...w, value: r.result } : w;
          })
        );
        setDebugLogs(prev => [...prev, `[DAP] Runtime value changed: ${expr} = ${payload.newValue}`]);
        showNavToast('Runtime Value Changed', `${expr} = ${payload.newValue}`);
        return { success: true, value: payload.newValue };
      }
      return { success: false, error: `Variable '${expr}' cannot be modified in current scope.` };
    },
    [isDebugging, isPaused, isRealDiskSolution, selectedFrameId, showNavToast, variables]
  );

  const handleOpenEvaluateModal = useCallback((expression: string, mode: 'evaluate' | 'setValue' = 'evaluate') => {
    setEvaluateModalState({
      isOpen: true,
      expression: expression || '',
      mode
    });
  }, []);

  // Serialize any paused expression/variable into pretty JSON & copy to clipboard
  const handleCopyExpressionAsJson = useCallback(
    async (expression: string) => {
      const clean = (expression || '').trim();
      if (!clean || !isDebugging || !isPaused) return;

      if (isRealDiskSolution) {
        const remote = await handleEvaluateDebugExpression(
          buildCSharpConversionExpression(clean, 'json-pretty'),
          'watch'
        );
        if (remote.success && remote.result && !remote.result.toLowerCase().includes('does not exist')) {
          let text = remote.result;
          if (text.startsWith('"') && text.endsWith('"')) {
            try {
              const parsed = JSON.parse(text);
              if (typeof parsed === 'string') text = parsed;
            } catch {}
          }
          navigator.clipboard?.writeText(text);
          showNavToast(`Copied '${clean}' as JSON`, `${text.length} chars`);
          return;
        }
      }

      const evalRes = await handleEvaluateDebugExpression(clean, 'watch');
      if (evalRes.success) {
        const local = await convertEvaluatedValueLocally(evalRes, 'json-pretty', handleExpandDebugVariables);
        navigator.clipboard?.writeText(local.formatted);
        showNavToast(`Copied '${clean}' as JSON`, `${local.formatted.length} chars`);
      } else {
        showNavToast('JSON Serialize Failed', evalRes.result || `Could not evaluate '${clean}'`);
      }
    },
    [handleEvaluateDebugExpression, handleExpandDebugVariables, isDebugging, isPaused, isRealDiskSolution, showNavToast]
  );

  // Generate cURL from HTTP / REST API call at cursor or paused breakpoint line
  const handleGenerateCurlFromLine = useCallback(
    async (lineOverride?: number) => {
      const targetFile =
        activeFile ||
        (pausedLocation ? findFileByPath(pausedLocation.filePath) : null);

      if (!targetFile || !targetFile.content) {
        setCurlModalState({
          isOpen: true,
          curlData: null,
          detectedCall: null,
          isGenerating: false,
          error: 'Open a C# source file containing an HTTP client call first.'
        });
        return;
      }

      const targetLine = lineOverride || currentCursorRef.current.line || pausedLocation?.line || 1;
      const detected = parseHttpCallAtLine(targetFile.content, targetLine);

      if (!detected) {
        setCurlModalState({
          isOpen: true,
          curlData: null,
          detectedCall: null,
          isGenerating: false,
          error: `No HTTP API invocation (GetQuery, PostAsJsonAsync, SendAsync, [HttpGet], etc.) detected around line ${targetLine} of ${targetFile.name}. Place the cursor or breakpoint on an API call line.`
        });
        return;
      }

      setCurlModalState({
        isOpen: true,
        curlData: null,
        detectedCall: detected,
        isGenerating: true,
        error: null
      });

      try {
        const fallbackBase =
          runningUrl ||
          getProjectLaunchEnv(selectedProject, currentPortOverride).url ||
          'http://localhost:5000';
        const result = await buildCurlFromCall(
          detected,
          handleEvaluateDebugExpression,
          handleExpandDebugVariables,
          fallbackBase
        );
        setCurlModalState({
          isOpen: true,
          curlData: result,
          detectedCall: detected,
          isGenerating: false,
          error: null
        });
      } catch (err: any) {
        setCurlModalState({
          isOpen: true,
          curlData: null,
          detectedCall: detected,
          isGenerating: false,
          error: err?.message || 'Failed resolving runtime parameters into cURL.'
        });
      }
    },
    [
      activeFile,
      currentPortOverride,
      findFileByPath,
      handleEvaluateDebugExpression,
      handleExpandDebugVariables,
      pausedLocation,
      runningUrl,
      selectedProject
    ]
  );

  // DLL Decompiler Handlers (opens read-only [Decompiled].cs editor tab)
  const openDecompiledSourceTab = useCallback(
    (payload: {
      assemblyName: string;
      dllPath: string;
      typeName?: string;
      source: string;
      engine: string;
    }) => {
      const shortType = payload.typeName ? payload.typeName.split('.').pop()?.split('`')[0] : undefined;
      const displayName = shortType
        ? `${shortType} [Decompiled].cs`
        : `${payload.assemblyName} [Decompiled].cs`;
      const banner = `// ============================================================================\n// Decompiled with SharpForge (.NET Engine: ${payload.engine})\n// Assembly: ${payload.assemblyName}\n// Path: ${payload.dllPath}\n${payload.typeName ? `// Type: ${payload.typeName}\n` : ''}// ============================================================================\n\n`;

      const decompiledFile: SolutionFileItem = {
        id: `decompiled-${payload.dllPath}-${payload.typeName || 'assembly'}`,
        name: displayName,
        path: `${payload.dllPath}#${payload.typeName || 'assembly'}`,
        relativePath: `${payload.assemblyName}.dll / ${shortType || 'Assembly'}`,
        extension: '.cs',
        isDirectory: false,
        isReadOnly: true,
        isDecompiled: true,
        assemblyName: payload.assemblyName,
        assemblyPath: payload.dllPath,
        content: banner + (payload.source || '// No IL source output.')
      };

      navigateToLocation(decompiledFile, 1, 1, true);
      showNavToast(`Decompiled ${payload.assemblyName}`, `Engine: ${payload.engine}`);
    },
    [navigateToLocation, showNavToast]
  );

  const handleDecompilePackage = useCallback(
    async (pkg: NuGetPackage, project: ProjectItem) => {
      if (!window.electronAPI?.decompileDll) {
        openDecompiledSourceTab({
          assemblyName: pkg.id,
          dllPath: `/nuget/packages/${pkg.id.toLowerCase()}/${pkg.version}/lib/${project.targetFramework}/${pkg.id}.dll`,
          source: `namespace ${pkg.id}\n{\n    // Open this solution inside SharpForge.app on macOS to decompile real NuGet .dll binaries via ilspycmd / MetadataLoadContext.\n    public static class AssemblyMetadata\n    {\n        public const string PackageId = "${pkg.id}";\n        public const string Version = "${pkg.resolvedVersion || pkg.version}";\n        public const string TargetFramework = "${project.targetFramework}";\n    }\n}\n`,
          engine: 'browser-metadata'
        });
        return;
      }

      showNavToast(`Decompiling ${pkg.id}...`, 'Inspecting NuGet / bin assembly');
      const res = await window.electronAPI.decompileDll({
        packageId: pkg.id,
        packageVersion: pkg.resolvedVersion || pkg.version,
        projectPath: project.path,
        targetFramework: project.targetFramework
      });
      if (res.success) {
        openDecompiledSourceTab(res);
      } else {
        showNavToast('Decompile Notice', res.error || `Could not locate ${pkg.id}.dll`);
      }
    },
    [openDecompiledSourceTab, showNavToast]
  );

  const handleDecompileDllPicker = useCallback(
    async (project: ProjectItem) => {
      if (!window.electronAPI?.decompilePickDll || !window.electronAPI?.decompileDll) {
        showNavToast('Desktop App Required', 'Picking arbitrary .dll files requires SharpForge.app on macOS');
        return;
      }
      const picked = await window.electronAPI.decompilePickDll();
      if (!picked) return;
      showNavToast('Decompiling Assembly...', picked.split('/').pop() || picked);
      const res = await window.electronAPI.decompileDll({
        dllPath: picked,
        projectPath: project.path,
        targetFramework: project.targetFramework
      });
      if (res.success) {
        openDecompiledSourceTab(res);
      } else {
        showNavToast('Decompile Failed', res.error || 'Could not decompile selected .dll');
      }
    },
    [openDecompiledSourceTab, showNavToast]
  );

  const handleDecompileFrame = useCallback(
    async (frame: StackFrame) => {
      if (!window.electronAPI?.decompileDll) {
        showNavToast('Desktop App Required', 'Stack frame .dll decompilation runs inside SharpForge.app');
        return;
      }
      const typeCandidate = frame.name.split('(')[0].split('.').slice(-2, -1)[0];
      const res = await window.electronAPI.decompileDll({
        dllPath: frame.file.endsWith('.dll') ? frame.file : undefined,
        packageId: frame.file.endsWith('.dll') ? frame.file.replace(/\.dll$/i, '').split('/').pop() : undefined,
        projectPath: selectedProject?.path,
        targetFramework: selectedProject?.targetFramework,
        typeName: typeCandidate
      });
      if (res.success) {
        openDecompiledSourceTab(res);
      } else {
        showNavToast('Decompile Notice', res.error || `Could not decompile ${frame.file}`);
      }
    },
    [openDecompiledSourceTab, selectedProject?.path, selectedProject?.targetFramework, showNavToast]
  );

  // Extension / Plugin Management Handlers
  const persistBrowserExtensions = (list: MarketplaceExtension[]) => {
    try {
      localStorage.setItem('sharpforge.extensions', JSON.stringify(list));
    } catch {}
  };

  const handleInstallExtension = useCallback(
    async (ext: MarketplaceExtension) => {
      if (window.electronAPI?.extensionsInstall) {
        const res = await window.electronAPI.extensionsInstall(ext);
        if (res.success && res.extension) {
          setInstalledExtensions(prev => {
            const next = [...prev.filter(e => e.id !== res.extension!.id), res.extension!];
            persistBrowserExtensions(next);
            return next;
          });
          showNavToast('Installed Extension', res.extension.displayName);
          return;
        }
        throw new Error(res.error || 'Theme import failed');
      }
      if (!ext.themes?.length) throw new Error('Browser preview supports bundled color themes only');

      const instRecord: MarketplaceExtension = { ...ext, installed: true, enabled: true };
      setInstalledExtensions(prev => {
        const next = [...prev.filter(e => e.id !== ext.id), instRecord];
        persistBrowserExtensions(next);
        return next;
      });
      showNavToast('Installed Extension', ext.displayName);
    },
    [showNavToast]
  );

  const handleUninstallExtension = useCallback(
    async (id: string) => {
      if (window.electronAPI?.extensionsUninstall) {
        await window.electronAPI.extensionsUninstall(id);
      }
      setInstalledExtensions(prev => {
        const next = prev.filter(e => e.id !== id);
        persistBrowserExtensions(next);
        return next;
      });
      showNavToast('Uninstalled Extension', id);
    },
    [showNavToast]
  );

  const handleToggleExtension = useCallback(
    async (id: string, enabled: boolean) => {
      if (window.electronAPI?.extensionsToggleEnabled) {
        const res = await window.electronAPI.extensionsToggleEnabled(id, enabled);
        if (res.success && res.extensions) {
          setInstalledExtensions(res.extensions);
          persistBrowserExtensions(res.extensions);
          return;
        }
      }
      setInstalledExtensions(prev => {
        const next = prev.map(e => (e.id === id ? { ...e, enabled } : e));
        persistBrowserExtensions(next);
        return next;
      });
    },
    []
  );

  // Test Runner Operations (real dotnet test + TRX XML parsing on disk solutions)
  const executeDotnetTests = useCallback(
    async (
      targetIds: Set<string> | null,
      options?: { filter?: string; targetPath?: string; label?: string }
    ) => {
      setIsRunningTests(true);
      setTests(prev =>
        prev.map(t =>
          !targetIds || targetIds.has(t.id) ? { ...t, status: 'running' } : t
        )
      );

      if (isRealDiskSolution && (window.electronAPI?.runTests || window.electronAPI?.runCommand)) {
        const targetPath = options?.targetPath || currentSolution.path;
        const cwd = getSolutionDir(currentSolution.path);
        const filter = options?.filter?.trim();
        setTerminalLogs(prev => [
          ...prev,
          `\n> dotnet test "${targetPath}"${filter ? ` --filter "${filter}"` : ''} --logger trx --verbosity normal`
        ]);

        let res: {
          success: boolean;
          stdout: string;
          stderr: string;
          code: number;
          trxContents?: Array<{ fileName: string; xml: string }>;
        };

        if (window.electronAPI.runTests) {
          res = await window.electronAPI.runTests({
            targetPath,
            cwd,
            filter,
            configuration: buildConfig
          });
        } else {
          const cmd = `dotnet test "${targetPath}"${filter ? ` --filter "${filter}"` : ''} --verbosity normal`;
          const cmdRes = await window.electronAPI.runCommand!(cmd, cwd);
          res = { ...cmdRes, trxContents: [] };
        }

        const output = `${res.stdout}\n${res.stderr}`;
        const lines = output.split('\n').filter(Boolean);
        setTerminalLogs(prev => [...prev, ...lines].slice(-5000));

        const parsedOutcomes = parseCombinedDotnetTestResults(
          res.trxContents,
          res.stdout,
          res.stderr
        );

        const fallbackError =
          !res.success && parsedOutcomes.length === 0
            ? (res.stderr || res.stdout || `dotnet test exited with code ${res.code}`).trim()
            : undefined;

        setTests(prev =>
          mergeTestResults(prev, parsedOutcomes, {
            targetedTestIds: targetIds ?? undefined,
            runSucceeded: res.success,
            fallbackErrorOutput: fallbackError
          })
        );
        setIsRunningTests(false);
        return;
      }

      // Browser preview fallback (sample solution)
      setTimeout(() => {
        setTests(prev => {
          const next = prev.map((t, idx) => {
            if (targetIds && !targetIds.has(t.id)) return t;
            if (t.skipReason) {
              return { ...t, status: 'skipped' as const, durationMs: 0 };
            }
            return { ...t, status: 'passed' as const, durationMs: t.durationMs || 10 + idx * 4 };
          });
          const passed = next.filter(t => t.status === 'passed').length;
          const failed = next.filter(t => t.status === 'failed').length;
          const skipped = next.filter(t => t.status === 'skipped').length;
          setTerminalLogs(logs => [
            ...logs,
            `\n> dotnet test ${options?.label || currentSolution.name}`,
            `Passed!  - Failed: ${failed}, Passed: ${passed}, Skipped: ${skipped}, Total: ${next.length}, Duration: 75 ms`
          ]);
          return next;
        });
        setIsRunningTests(false);
      }, 450);
    },
    [buildConfig, currentSolution.name, currentSolution.path, isRealDiskSolution]
  );

  const handleRunAllTests = useCallback(async () => {
    setBottomPanelTab('terminal');
    setIsBottomPanelOpen(true);
    await executeDotnetTests(null, { label: currentSolution.name });
  }, [currentSolution.name, executeDotnetTests]);

  const handleRunFailedTests = useCallback(async () => {
    const failed = tests.filter(t => t.status === 'failed');
    if (failed.length === 0) return;
    const targetIds = new Set(failed.map(t => t.id));
    const uniqueNames = Array.from(
      new Set(failed.map(t => t.fullName.split('(')[0].trim()).filter(Boolean))
    );
    const filter = uniqueNames.map(n => `FullyQualifiedName~${n}`).join('|');
    setBottomPanelTab('terminal');
    setIsBottomPanelOpen(true);
    await executeDotnetTests(targetIds, {
      filter,
      label: `Failed Tests (${failed.length})`
    });
  }, [executeDotnetTests, tests]);

  const handleRunTestGroup = useCallback(
    async (scope: { projectName: string; className?: string; namespace?: string }) => {
      const matching = tests.filter(
        t =>
          t.projectName === scope.projectName &&
          (!scope.className || t.className === scope.className)
      );
      if (matching.length === 0) return;
      const targetIds = new Set(matching.map(t => t.id));
      const projectObj = currentSolution.projects.find(p => p.name === scope.projectName);
      const targetPath =
        projectObj?.path && projectObj.path.endsWith('.csproj')
          ? projectObj.path
          : currentSolution.path;
      const classFqn = scope.className
        ? scope.namespace
          ? `${scope.namespace}.${scope.className}`
          : scope.className
        : undefined;
      setBottomPanelTab('terminal');
      setIsBottomPanelOpen(true);
      await executeDotnetTests(targetIds, {
        targetPath,
        filter: classFqn ? `FullyQualifiedName~${classFqn}` : undefined,
        label: scope.className ? `${scope.projectName}.${scope.className}` : scope.projectName
      });
    },
    [currentSolution.path, currentSolution.projects, executeDotnetTests, tests]
  );

  const handleRunSingleTest = useCallback(
    async (test: TestItem) => {
      const targetIds = new Set([test.id]);
      const baseFqn = test.fullName.split('(')[0].trim();
      const projectObj = currentSolution.projects.find(p => p.name === test.projectName);
      const targetPath =
        projectObj?.path && projectObj.path.endsWith('.csproj')
          ? projectObj.path
          : currentSolution.path;
      await executeDotnetTests(targetIds, {
        targetPath,
        filter: `FullyQualifiedName~${baseFqn}`,
        label: test.methodName
      });
    },
    [currentSolution.path, currentSolution.projects, executeDotnetTests]
  );

  const handleDebugTest = (test: TestItem) => {
    if (isRealDiskSolution) {
      handleNavigateToTest(test);
      setBottomPanelTab('terminal');
      setIsBottomPanelOpen(true);
      handleRunSingleTest(test);
      return;
    }
    handleDebug();
    setDebugLogs(prev => [...prev, `[DAP] Debug session started for test: ${test.methodName}`]);
  };

  const handleNavigateToTest = (test: TestItem) => {
    if (test.filePath) {
      openFileAtLocation(test.filePath, test.line || 1, 1);
      return;
    }
    const all = getAllSolutionFiles(currentSolution);
    const match = all.find(
      item => item.project.name === test.projectName && item.file.name.includes(test.className)
    );
    if (match) {
      const cleanMethod = test.methodName.split('(')[0];
      const lines = (match.file.content || '').split('\n');
      const idx = lines.findIndex(l => l.includes(cleanMethod));
      navigateToLocation(match.file, idx !== -1 ? idx + 1 : 1, 1, true);
    }
  };

  // Real NuGet Package Install & Uninstall
  const handleInstallPackage = async (project: ProjectItem, packageId: string, version: string) => {
    if (isRealDiskSolution && window.electronAPI?.runCommand && project.path.endsWith('.csproj')) {
      setBottomPanelTab('terminal');
      setIsBottomPanelOpen(true);
      const cmd = `dotnet add "${project.path}" package ${packageId} --version ${version}`;
      setTerminalLogs(prev => [...prev, `\n> ${cmd}`]);
      const res = await window.electronAPI.runCommand(cmd, getSolutionDir(currentSolution.path));
      const lines = `${res.stdout}\n${res.stderr}`.split('\n').filter(Boolean);
      setTerminalLogs(prev => [...prev, ...lines].slice(-5000));
      if (res.success && window.electronAPI.loadSolution) {
        const reloaded = await window.electronAPI.loadSolution(currentSolution.path);
        handleLoadedSolution(reloaded);
        showNavToast('NuGet Package Installed', `${packageId} v${version}`);
        return;
      }
    }

    const updated = { ...project };
    if (!updated.dependencies.packages.some(p => p.id === packageId)) {
      updated.dependencies.packages.push({ id: packageId, version, resolvedVersion: version, isDirect: true });
    }
    setSolutions(prev => prev.map(s => ({ ...s, projects: s.projects.map(p => (p.id === project.id ? updated : p)) })));
    setSelectedProject(updated);
    setTerminalLogs(prev => [...prev, `\n> dotnet add ${project.name}.csproj package ${packageId} --version ${version}`]);
  };

  const handleUninstallPackage = async (project: ProjectItem, packageId: string) => {
    if (isRealDiskSolution && window.electronAPI?.runCommand && project.path.endsWith('.csproj')) {
      const cmd = `dotnet remove "${project.path}" package ${packageId}`;
      setTerminalLogs(prev => [...prev, `\n> ${cmd}`]);
      const res = await window.electronAPI.runCommand(cmd, getSolutionDir(currentSolution.path));
      const lines = `${res.stdout}\n${res.stderr}`.split('\n').filter(Boolean);
      setTerminalLogs(prev => [...prev, ...lines].slice(-5000));
      if (res.success && window.electronAPI.loadSolution) {
        const reloaded = await window.electronAPI.loadSolution(currentSolution.path);
        handleLoadedSolution(reloaded);
        showNavToast('NuGet Package Removed', packageId);
        return;
      }
    }

    const updated = { ...project };
    updated.dependencies.packages = updated.dependencies.packages.filter(p => p.id !== packageId);
    setSolutions(prev => prev.map(s => ({ ...s, projects: s.projects.map(p => (p.id === project.id ? updated : p)) })));
    setSelectedProject(updated);
    setTerminalLogs(prev => [...prev, `\n> dotnet remove ${project.name}.csproj package ${packageId}`]);
  };

  // Find Usages (⌥F7 / ⇧F12)
  const handleFindReferences = useCallback(
    (file: SolutionFileItem, line: number, character: number, symbolText?: string) => {
      const { symbolName, references: found } = resolveCSharpUsages(
        currentSolution,
        file,
        line,
        character,
        symbolText
      );
      setReferences(found);
      setBottomPanelTab('references');
      setIsBottomPanelOpen(true);
      if (symbolName) {
        showNavToast(`Find Usages: ${symbolName}`, `Found ${found.length} usage(s) in ${currentSolution.name}`);
      }
    },
    [currentSolution, showNavToast]
  );

  // Go to Implementation (⌥⌘B, Cmd+F12, Context Menu) — falls back to DLL Decompiler if symbol is external
  const handleGoToImplementation = useCallback(
    async (file: SolutionFileItem, line: number, character: number, symbolText?: string) => {
      const { symbolName, targets } = resolveCSharpImplementations(
        currentSolution,
        file,
        line,
        character,
        symbolText
      );

      if (targets.length === 0) {
        const lookupSym = symbolText || symbolName;
        if (isRealDiskSolution && lookupSym && window.electronAPI?.decompileFindSymbol && selectedProject?.path) {
          showNavToast(`Searching Referenced .dlls...`, `Looking up '${lookupSym}'`);
          const decomp = await window.electronAPI.decompileFindSymbol({
            symbolName: lookupSym,
            projectPath: selectedProject.path,
            targetFramework: selectedProject.targetFramework
          });
          if (decomp?.success) {
            openDecompiledSourceTab(decomp);
            return;
          }
        }
        showNavToast(
          'No Implementation Found',
          symbolName ? `Could not resolve concrete implementation for '${symbolName}'` : 'Place cursor on an interface, method, or service call'
        );
        return;
      }

      const nonTestTargets = targets.filter(
        t => !t.file.toLowerCase().includes('.tests') && !t.file.toLowerCase().includes('/tests/') && !t.name.toLowerCase().includes('mock')
      );
      const effectiveSingle =
        targets.length === 1
          ? targets[0]
          : nonTestTargets.length === 1
          ? nonTestTargets[0]
          : null;

      if (effectiveSingle) {
        const targetFile = findFileByPath(effectiveSingle.file);
        if (targetFile) {
          navigateToLocation(targetFile, effectiveSingle.line, effectiveSingle.column, true);
          showNavToast('Navigated to Implementation', `${effectiveSingle.name} — ${targetFile.name}:${effectiveSingle.line}`);
          return;
        }
      }

      setImplementationPickerData({ symbolName: symbolName || 'Symbol', items: targets });
      setIsImplementationPickerOpen(true);
    },
    [
      currentSolution,
      findFileByPath,
      isRealDiskSolution,
      navigateToLocation,
      openDecompiledSourceTab,
      selectedProject?.path,
      selectedProject?.targetFramework,
      showNavToast
    ]
  );

  // Go to Definition (Cmd+Click, Ctrl+Click, Cmd+B, F12) — falls back to DLL Decompiler if symbol is external
  const handleGoToDefinition = useCallback(
    async (file: SolutionFileItem, line: number, character: number, symbolText?: string) => {
      const { symbolName, targets } = resolveCSharpDefinition(
        currentSolution,
        file,
        line,
        character,
        symbolText
      );

      if (targets.length === 0) {
        const lookupSym = symbolText || symbolName;
        if (isRealDiskSolution && lookupSym && window.electronAPI?.decompileFindSymbol && selectedProject?.path) {
          showNavToast(`Decompiling Symbol...`, `Searching '${lookupSym}' in referenced assemblies`);
          const decomp = await window.electronAPI.decompileFindSymbol({
            symbolName: lookupSym,
            projectPath: selectedProject.path,
            targetFramework: selectedProject.targetFramework
          });
          if (decomp?.success) {
            openDecompiledSourceTab(decomp);
            return;
          }
        }
        showNavToast(
          'No Definition Found',
          symbolName ? `No declaration found for '${symbolName}' in solution` : 'Place cursor on a symbol'
        );
        return;
      }

      if (targets.length === 1) {
        const t = targets[0];
        const targetFile = findFileByPath(t.file);
        if (targetFile) {
          navigateToLocation(targetFile, t.line, t.column, true);
          showNavToast('Navigated to Definition', `${t.name} — ${targetFile.name}:${t.line}`);
          return;
        }
      }

      setImplementationPickerData({ symbolName: symbolName || 'Definition', items: targets });
      setIsImplementationPickerOpen(true);
    },
    [
      currentSolution,
      findFileByPath,
      isRealDiskSolution,
      navigateToLocation,
      openDecompiledSourceTab,
      selectedProject?.path,
      selectedProject?.targetFramework,
      showNavToast
    ]
  );

  // Solution-wide Search
  const runSolutionSearch = useCallback(
    (query: string) => {
      setSolutionSearchQuery(query);
      if (!query.trim()) {
        setSolutionSearchResults([]);
        return;
      }
      setSolutionSearchResults(searchInSolution(currentSolution, query));
    },
    [currentSolution]
  );

  // AppSettings Environment Variables
  const handleOpenAppSettingsEnv = (file?: SolutionFileItem) => {
    const target =
      file ||
      currentSolution.projects[0]?.files.find(f => f.name.toLowerCase().includes('appsettings')) ||
      null;
    setAppSettingsTargetFile(target);
    setIsAppSettingsModalOpen(true);
  };

  const handleSyncToLaunchSettings = (envVars: Record<string, string>) => {
    const projName = selectedProject.name;
    const updatedProj = { ...selectedProject };
    if (!updatedProj.launchSettings) updatedProj.launchSettings = { profiles: {} };
    if (!updatedProj.launchSettings.profiles[projName]) {
      updatedProj.launchSettings.profiles[projName] = {
        commandName: 'Project',
        dotnetRunMessages: true,
        launchBrowser: true,
        applicationUrl: 'http://localhost:5124',
        environmentVariables: {}
      };
    }
    updatedProj.launchSettings.profiles[projName].environmentVariables = {
      ...(updatedProj.launchSettings.profiles[projName].environmentVariables || {}),
      ...envVars
    };
    const launchFile = updatedProj.files
      .find(f => f.name === 'Properties')?.children
      ?.find(f => f.name === 'launchSettings.json');
    if (launchFile) {
      launchFile.content = JSON.stringify(updatedProj.launchSettings, null, 2);
      if (window.electronAPI?.saveFile && launchFile.path.startsWith('/')) {
        window.electronAPI.saveFile(launchFile.path, launchFile.content);
      }
    }
    setSolutions(prev => prev.map(s => ({ ...s, projects: s.projects.map(p => (p.id === updatedProj.id ? updatedProj : p)) })));
    setSelectedProject(updatedProj);
    showNavToast('Environment Variables Configured', `Synced ${Object.keys(envVars).length} variables to launchSettings.json`);
  };

  const handleSaveEnvFile = (content: string) => {
    const proj = { ...selectedProject };
    const existing = proj.files.find(f => f.name === '.env');
    if (existing) {
      existing.content = content;
    } else {
      proj.files.push({
        id: `f-dotenv-${Date.now()}`,
        name: '.env',
        path: `${proj.path}/.env`,
        relativePath: '.env',
        extension: '.env',
        isDirectory: false,
        content
      });
    }
    setSolutions(prev => prev.map(s => ({ ...s, projects: s.projects.map(p => (p.id === proj.id ? proj : p)) })));
    setSelectedProject(proj);
    showNavToast('.env Generated', `Saved .env file`);
  };

  // Interactive Terminal Command Executor
  const handleExecuteTerminalCommand = async (cmd: string) => {
    setTerminalLogs(prev => [...prev, `${currentSolution.name}$ ${cmd}`]);
    const lower = cmd.trim().toLowerCase();

    if (lower === 'clear' || lower === 'cls') {
      setTerminalLogs([]);
      return;
    }
    if (lower === 'help' || lower === 'dotnet --help') {
      setTerminalLogs(prev => [
        ...prev,
        `.NET CLI & Shell Commands:`,
        `  dotnet build / restore / run / test / sln list / --list-sdks / --info`,
        `  git status / git diff / clear`
      ]);
      return;
    }
    if (lower === 'dotnet build') {
      handleBuild();
      return;
    }
    if (lower === 'dotnet run') {
      handleRun();
      return;
    }
    if (lower === 'dotnet test') {
      handleRunAllTests();
      return;
    }
    if (lower === 'dotnet restore') {
      handleRestoreDependencies();
      return;
    }
    if (lower.startsWith('dotnet sln list')) {
      setTerminalLogs(prev => [...prev, `Project(s)`, `----------`, ...currentSolution.projects.map(p => `${p.name} [${p.targetFramework}]`)]);
      return;
    }
    if (lower.startsWith('dotnet --list-sdks')) {
      setTerminalLogs(prev => [...prev, ...detectedSdks.map(sdk => `${sdk} [${sdkPath}/sdk]`)]);
      return;
    }

    if (window.electronAPI?.runCommand) {
      const res = await window.electronAPI.runCommand(
        cmd,
        isRealDiskSolution ? getSolutionDir(currentSolution.path) : undefined
      );
      const lines = `${res.stdout}\n${res.stderr}`.split('\n').filter(Boolean);
      setTerminalLogs(prev => [...prev, ...(lines.length > 0 ? lines : [`Exited with code ${res.code}`])]);
      return;
    }

    setTerminalLogs(prev => [...prev, `Executed: ${cmd}`]);
  };

  // Detect Installed .NET SDKs & Subscribe to Electron Native Events on Mount
  useEffect(() => {
    const api = window.electronAPI;
    if (!api) return;

    api.detectSdks?.().then(({ current, sdks }) => {
      if (sdks && sdks.length > 0) {
        setDetectedSdks(sdks);
        const mapped = frameworkToSdkLabel(`net${current}`);
        if (mapped) setActiveSdk(mapped);
        setTerminalLogs(prev => [...prev, `[SDK Detector] Found installed .NET SDKs: ${sdks.join(', ')}`]);
      }
    }).catch(() => {});

    api.extensionsListInstalled?.().then((extList) => {
      if (Array.isArray(extList) && extList.length > 0) {
        setInstalledExtensions(extList);
        persistBrowserExtensions(extList);
      }
    }).catch(() => {});

    refreshActivePorts();

    // Load persistent recent solutions from ~/.sharpforge/recent-solutions.json & auto-reopen last .sln
    if (!startupRestoreAttemptedRef.current) {
      startupRestoreAttemptedRef.current = true;
      (async () => {
        let diskRecents: RecentSolutionEntry[] = [];
        try {
          if (api.recentSolutionsList) {
            diskRecents = await api.recentSolutionsList();
            if (Array.isArray(diskRecents)) {
              setRecentSolutions(diskRecents);
              try {
                localStorage.setItem('sharpforge.recentSolutions', JSON.stringify(diskRecents));
              } catch {}
            }
          }
        } catch {}

        const savedLastPath = (() => {
          try {
            return (
              localStorage.getItem('sharpforge.lastSolutionPath') ??
              localStorage.getItem('minirider.lastSolutionPath')
            );
          } catch {
            return null;
          }
        })();

        const candidatePath =
          diskRecents.find(r => r.exists !== false && r.path.startsWith('/'))?.path ||
          (savedLastPath && savedLastPath.startsWith('/') && !SAMPLE_SOLUTIONS.some(s => s.path === savedLastPath)
            ? savedLastPath
            : null);

        if (candidatePath && api.loadSolution) {
          try {
            const restored = await api.loadSolution(candidatePath);
            if (restored) {
              handleLoadedSolution(restored);
            }
          } catch {
            // Last solution no longer exists; keep default and refresh recents list
            if (api.recentSolutionsList) {
              api.recentSolutionsList().then(setRecentSolutions).catch(() => {});
            }
          }
        }
      })();
    }

    const unsubscribers: Array<() => void> = [];

    if (api.onSolutionOpened) {
      unsubscribers.push(api.onSolutionOpened(sol => handleLoadedSolution(sol)));
    }

    if (api.onProcessOutput) {
      unsubscribers.push(
        api.onProcessOutput(({ processId, stream, text }) => {
          const key = `${processId}:${stream}`;
          const chunks = ((outputFragments.current.get(key) || '') + text).replace(/\r/g, '').split('\n');
          outputFragments.current.set(key, chunks.pop()!.slice(-65536));
          const lines = chunks.filter(Boolean);
          if (lines.length > 0) {
            setTerminalLogs(prev => [...prev, ...lines].slice(-5000));
            for (const ln of lines) {
              const listenMatch = ln.match(/Now listening on:\s*(https?:\/\/[^\s]+)/i);
              if (listenMatch) {
                setRunningUrl(listenMatch[1].trim());
                refreshActivePorts();
              }
              if (/address already in use|AddressInUseException/i.test(ln)) {
                refreshActivePorts();
                setPortModalState({ isOpen: true, pendingLaunchMode: null });
              }
            }
          }
        })
      );
    }

    if (api.onProcessExit) {
      unsubscribers.push(
        api.onProcessExit(({ processId, code }) => {
          for (const stream of ['stdout', 'stderr']) {
            const key = `${processId}:${stream}`;
            const tail = outputFragments.current.get(key);
            if (tail) setTerminalLogs(prev => [...prev, tail].slice(-5000));
            outputFragments.current.delete(key);
          }
          if (activeProcessIdRef.current === processId) {
            activeProcessIdRef.current = null;
          }
          setIsRunning(false);
          setRunningUrl(null);
          setTerminalLogs(prev => [...prev, `[Process] Exited with code ${code}`]);
          if (typeof code === 'number' && code !== 0) setWorkbenchOpen(true);
          refreshActivePorts();
        })
      );
    }

    if (api.onDebugEvent) {
      unsubscribers.push(
        api.onDebugEvent(evt => {
          if (!evt) return;
          if (evt.event === 'output' && evt.output) {
            const key = 'debug';
            const chunks = ((outputFragments.current.get(key) || '') + String(evt.output)).replace(/\r/g, '').split('\n');
            outputFragments.current.set(key, chunks.pop()!.slice(-65536));
            const lines = chunks.filter(Boolean);
            if (lines.length > 0) {
              setDebugLogs(prev => [...prev, ...lines].slice(-5000));
              for (const ln of lines) {
                const listenMatch = ln.match(/Now listening on:\s*(https?:\/\/[^\s]+)/i);
                if (listenMatch) {
                  setRunningUrl(listenMatch[1].trim());
                  refreshActivePorts();
                }
                if (/address already in use|AddressInUseException/i.test(ln)) {
                  refreshActivePorts();
                  setPortModalState({ isOpen: true, pendingLaunchMode: null });
                }
              }
            }
          } else if (evt.event === 'stopped') {
            if (evt.reason === 'exception') setWorkbenchOpen(true);
            setIsPaused(true);
            setIsDebugging(true);
            const frames: StackFrame[] = evt.stackFrames || [];
            const vars: VariableItem[] = evt.variables || [];
            setCallStack(frames);
            setVariables(vars);

            const top = frames[0];
            let retEntry: ReturnValueEntry | null = evt.returnValue
              ? {
                  id: `ret-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
                  functionName: formatShortFunctionName(evt.returnValue.functionName || top?.name || ''),
                  returnType: evt.returnValue.returnType || 'object',
                  value: evt.returnValue.value,
                  file: evt.returnValue.file || top?.file || '',
                  line: evt.returnValue.line || top?.line || 1,
                  timestamp: new Date().toLocaleTimeString()
                }
              : top
              ? extractReturnValuesFromVariables(vars, top.name, top.file, top.line)
              : null;

            if (retEntry) {
              setReturnValues(prev => [retEntry!, ...prev].slice(0, 50));
            }

            if (top) {
              setExecutionTrace(prev => {
                const step: ExecutionTraceStep = {
                  id: `trace-${Date.now()}-${prev.length + 1}`,
                  stepNumber: prev.length + 1,
                  functionName: top.name,
                  shortName: formatShortFunctionName(top.name),
                  file: top.file,
                  line: top.line,
                  reason: evt.reason || 'breakpoint',
                  timestamp: new Date().toLocaleTimeString(),
                  parameters: top.parameters || [],
                  locals: top.localsSnapshot || [],
                  returnValue: retEntry || undefined
                };
                return [...prev, step].slice(-60);
              });

              setSelectedFrameId(top.id);
              setPausedLocation({ filePath: top.file, line: top.line });
              openFileAtLocation(top.file, top.line, top.column || 1);

              if (api.debugEvaluate) {
                const topFrameId = top.id;
                setWatchExpressions(prev => {
                  if (prev.length > 0) {
                    Promise.all(
                      prev.map(async w => {
                        const r = await api.debugEvaluate!(w.expression, topFrameId, 'watch');
                        return { ...w, value: r.result ?? w.value };
                      })
                    ).then(updated => setWatchExpressions(updated));
                  }
                  return prev;
                });
              }
            }
            setDebugLogs(prev => [
              ...prev,
              `[DAP] Paused (${evt.reason || 'breakpoint'})${frames[0] ? ` at ${frames[0].file.split('/').pop()}:${frames[0].line}` : ''}${retEntry ? ` | Return: ${retEntry.value}` : ''}`
            ]);
          } else if (evt.event === 'continued') {
            setIsPaused(false);
            setPausedLocation(null);
          } else if (evt.event === 'terminated' || evt.event === 'exited') {
            const tail = outputFragments.current.get('debug');
            if (tail) setDebugLogs(prev => [...prev, tail].slice(-5000));
            outputFragments.current.delete('debug');
            setIsDebugging(false);
            setIsPaused(false);
            setPausedLocation(null);
            setRunningUrl(null);
            setDebugLogs(prev => [...prev, `[DAP] Debug target exited.`]);
          }
        })
      );
    }

    if (api.onMenuAction) {
      unsubscribers.push(api.onMenuAction('action:build', () => handleBuild()));
      unsubscribers.push(api.onMenuAction('action:run', () => handleRun()));
      unsubscribers.push(api.onMenuAction('action:debug', () => handleDebug()));
      unsubscribers.push(api.onMenuAction('action:pause-debug', () => handlePauseDebug()));
      unsubscribers.push(api.onMenuAction('action:stop', () => handleStop()));
      unsubscribers.push(api.onMenuAction('action:step-over', () => handleStepOver()));
      unsubscribers.push(api.onMenuAction('action:step-into', () => handleStepInto()));
      unsubscribers.push(api.onMenuAction('action:step-out', () => handleStepOut()));
      unsubscribers.push(api.onMenuAction('action:save', () => handleSaveFile()));
      unsubscribers.push(api.onMenuAction('action:navigate-back', () => handleNavigateBack()));
      unsubscribers.push(api.onMenuAction('action:navigate-forward', () => handleNavigateForward()));
      unsubscribers.push(api.onMenuAction('action:quick-open', () => setIsQuickOpenOpen(true)));
      unsubscribers.push(api.onMenuAction('action:open-settings', () => setIsSettingsOpen(true)));
      unsubscribers.push(
        api.onMenuAction('action:go-to-implementation', () => {
          if (activeFile) {
            handleGoToImplementation(activeFile, currentCursorRef.current.line, currentCursorRef.current.column);
          }
        })
      );
      unsubscribers.push(
        api.onMenuAction('action:go-to-declaration', () => {
          if (activeFile) {
            handleGoToDefinition(activeFile, currentCursorRef.current.line, currentCursorRef.current.column);
          }
        })
      );
    }

    return () => {
      unsubscribers.forEach(fn => {
        try {
          fn();
        } catch {}
      });
    };
  }, [
    activeFile,
    findFileByPath,
    handleBuild,
    handleDebug,
    handleGoToDefinition,
    handleGoToImplementation,
    handleLoadedSolution,
    handleNavigateBack,
    handleNavigateForward,
    handlePauseDebug,
    handleRun,
    handleSaveFile,
    handleStepInto,
    handleStepOut,
    handleStepOver,
    handleStop,
    navigateToLocation,
    openFileAtLocation
  ]);

  // Global Keyboard Shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const mod = e.metaKey || e.ctrlKey;

      if (mod && !e.shiftKey && !e.altKey && e.key.toLowerCase() === 's') {
        e.preventDefault();
        handleSaveFile();
      } else if (mod && !e.shiftKey && !e.altKey && e.key.toLowerCase() === 'o') {
        e.preventDefault();
        handleOpenSolutionFile();
      } else if ((mod && e.altKey && e.key === 'ArrowLeft') || (mod && !e.shiftKey && e.key === '[')) {
        e.preventDefault();
        handleNavigateBack();
      } else if ((mod && e.altKey && e.key === 'ArrowRight') || (mod && !e.shiftKey && e.key === ']')) {
        e.preventDefault();
        handleNavigateForward();
      } else if (mod && e.shiftKey && e.key.toLowerCase() === 'f') {
        e.preventDefault();
        setActiveSidebarTab('search');
      } else if (e.key === 'F5' && !e.shiftKey) {
        e.preventDefault();
        if (isPaused) handleContinue();
        else handleDebug();
      } else if (e.key === 'F5' && e.shiftKey) {
        e.preventDefault();
        handleStop();
      } else if (e.key === 'F9') {
        e.preventDefault();
        if (activeFile) handleToggleBreakpoint(activeFile.path, currentCursorRef.current.line || 1);
      } else if (e.key === 'F10') {
        e.preventDefault();
        handleStepOver();
      } else if (e.key === 'F11' && !e.shiftKey) {
        e.preventDefault();
        handleStepInto();
      } else if (e.key === 'F11' && e.shiftKey) {
        e.preventDefault();
        handleStepOut();
      } else if (mod && e.key.toLowerCase() === 'p') {
        e.preventDefault();
        setIsQuickOpenOpen(true);
      } else if (mod && e.shiftKey && e.key.toLowerCase() === 'b') {
        e.preventDefault();
        handleBuild();
      } else if (mod && !e.shiftKey && e.key.toLowerCase() === 'r') {
        e.preventDefault();
        handleRun();
      } else if ((mod && e.altKey && e.key.toLowerCase() === 'b') || (mod && e.key === 'F12')) {
        e.preventDefault();
        if (activeFile) {
          handleGoToImplementation(activeFile, currentCursorRef.current.line, currentCursorRef.current.column);
        }
      } else if ((mod && !e.altKey && e.key.toLowerCase() === 'b') || (e.key === 'F12' && !mod)) {
        e.preventDefault();
        if (activeFile) {
          handleGoToDefinition(activeFile, currentCursorRef.current.line, currentCursorRef.current.column);
        }
      } else if (e.altKey && e.key === 'F8') {
        e.preventDefault();
        if (isDebugging && isPaused) {
          handleOpenEvaluateModal('', 'evaluate');
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [
    activeFile,
    handleBuild,
    handleContinue,
    handleDebug,
    handleGoToDefinition,
    handleGoToImplementation,
    handleNavigateBack,
    handleNavigateForward,
    handleOpenEvaluateModal,
    handleOpenSolutionFile,
    handleRun,
    handleSaveFile,
    handleStepInto,
    handleStepOut,
    handleStepOver,
    handleStop,
    handleToggleBreakpoint,
    isDebugging,
    isPaused
  ]);

  const setupScriptSnippet = `#!/bin/bash
set -e
cd "$(dirname "$0")"
npm install --legacy-peer-deps
npm install --save-dev --legacy-peer-deps electron electron-builder
rm -rf dist/mac* dist/*.dmg dist/*.app 2>/dev/null || true
npm run build
export CSC_IDENTITY_AUTO_DISCOVERY=false
ARCH=$(uname -m)
npx --yes electron-builder --mac --$ARCH -c.directories.output=dist -c.mac.identity=null
cp -R dist/mac-$ARCH/SharpForge.app dist/SharpForge.app 2>/dev/null || cp -R dist/mac/SharpForge.app dist/SharpForge.app 2>/dev/null || true
echo "Built dist/SharpForge.app"
`;

  const canNavigateBack = navIndex > 0;
  const canNavigateForward = navIndex >= 0 && navIndex < navHistory.length - 1;

  return (
    <div className="flex flex-col h-screen w-screen bg-[#1e1f22] text-[#bcbec4] select-none font-sans overflow-hidden">
      <input ref={slnInputRef} type="file" accept=".sln,.slnx" className="hidden" onChange={handleBrowserSlnChange} />
      <input
        ref={folderInputRef}
        type="file"
        {...({ webkitdirectory: '', directory: '' } as any)}
        className="hidden"
        onChange={handleBrowserFolderChange}
      />

      <button className="absolute bottom-1 right-4 z-50 bg-[#34373d] text-blue-200 px-3 rounded" onClick={() => setWorkbenchOpen(true)}>Exceptions & tasks</button>
      {workbenchOpen && <DeveloperWorkbench key={currentSolution.path} workspace={currentSolution.path} logs={[...terminalLogs.slice(-3000), ...debugLogs.slice(-3000)].join('\n')} onClose={() => setWorkbenchOpen(false)} onNavigate={(file, line) => openFileAtLocation(file, line, 1)} onBuild={handleBuild} onRun={() => handleRun()} onDebug={() => handleDebug()} onFailedTests={handleRunFailedTests} onCommand={handleExecuteTerminalCommand} />}
      {/* Top Application Toolbar */}
      <Toolbar
        solutions={solutions}
        currentSolution={currentSolution}
        onSelectSolution={handleSelectSolution}
        selectedProject={selectedProject}
        onSelectProject={(proj) => {
          setSelectedProject(proj);
          const mapped = frameworkToSdkLabel(proj.targetFramework);
          if (mapped) setActiveSdk(mapped);
        }}
        buildConfig={buildConfig}
        onSelectBuildConfig={setBuildConfig}
        isBuilding={isBuilding}
        isRunning={isRunning}
        isDebugging={isDebugging}
        isPaused={isPaused}
        runningUrl={runningUrl}
        onBuild={handleBuild}
        onRun={() => handleRun()}
        onDebug={() => handleDebug()}
        onStop={handleStop}
        onPauseDebug={handlePauseDebug}
        onContinueDebug={handleContinue}
        onStepOver={handleStepOver}
        onStepInto={handleStepInto}
        onOpenQuickOpen={() => setIsQuickOpenOpen(true)}
        onOpenSetupModal={() => setIsSetupModalOpen(true)}
        onOpenSettings={() => setIsSettingsOpen(true)}
        onOpenRunningUrl={(url) => {
          if (window.electronAPI?.openExternal) {
            window.electronAPI.openExternal(url);
          }
        }}
        onOpenSolutionFile={handleOpenSolutionFile}
        onOpenFolder={handleOpenFolder}
        activeSdk={activeSdk}
        detectedSdks={detectedSdks}
        onSelectSdk={(sdk) => {
          setActiveSdk(sdk);
          showNavToast('Active .NET SDK Updated', `Targeting ${sdk}`);
        }}
        onNavigateBack={handleNavigateBack}
        onNavigateForward={handleNavigateForward}
        canNavigateBack={canNavigateBack}
        canNavigateForward={canNavigateForward}
        onOpenExtensions={() => setActiveSidebarTab('extensions')}
        configuredPort={resolvedProjectLaunch.port}
        isCustomPort={resolvedProjectLaunch.isCustomOverride}
        isPortInUse={isConfiguredPortInUse}
        onOpenPortManager={() => {
          refreshActivePorts();
          setPortModalState({ isOpen: true, pendingLaunchMode: null });
        }}
        recentSolutions={recentSolutions}
        onOpenRecentSolution={handleOpenRecentSolution}
        onRemoveRecentSolution={handleRemoveRecentSolution}
        onClearRecentSolutions={handleClearRecentSolutions}
      />

      {/* Main Workspace Body */}
      <div className="flex-1 flex overflow-hidden">
        <Sidebar
          activeTab={activeSidebarTab}
          onSelectTab={(tab) => {
            setActiveSidebarTab(tab);
            if (tab === 'git') refreshGitStatus();
          }}
          testCount={tests.length}
          gitChangesCount={gitIsRepo ? gitChanges.length : dirtyFileIds.size}
          extensionsCount={installedExtensions.filter(e => e.enabled !== false).length}
          onOpenShortcutsModal={() => setIsShortcutsOpen(true)}
        />

        {/* Resizable Left Side Tool Window */}
        <div
          style={{ width: `${sidebarWidth}px` }}
          className="bg-[#1e1f22] border-r border-[#2b2d30] flex flex-col shrink-0"
        >
          {activeSidebarTab === 'explorer' && (
            <SolutionExplorer
              solution={currentSolution}
              selectedFile={activeFile}
              onSelectFile={handleSelectFile}
              selectedProject={selectedProject}
              onSetStartupProject={setSelectedProject}
              onRevealInFinder={handleRevealInFinder}
              onOpenNuGetForProject={(p) => {
                setSelectedProject(p);
                setActiveSidebarTab('nuget');
              }}
              onAddFileToProject={(p, folderPath) => {
                setNewFileModalState({ isOpen: true, project: p, folderRelativePath: folderPath });
              }}
              onDeleteFile={handleDeleteFile}
              onBuildProject={() => handleBuild()}
              onOpenAppSettingsEnv={handleOpenAppSettingsEnv}
              onRestoreDependencies={handleRestoreDependencies}
              isRestoring={isRestoringDeps}
              revealSignal={locateInExplorerNonce}
              onDecompilePackage={handleDecompilePackage}
              onDecompileDll={handleDecompileDllPicker}
            />
          )}

          {activeSidebarTab === 'tests' && (
            <TestExplorer
              tests={tests}
              solutionName={currentSolution.name}
              onRunAllTests={handleRunAllTests}
              onRunFailedTests={handleRunFailedTests}
              onRunTestGroup={handleRunTestGroup}
              onRunTest={handleRunSingleTest}
              onDebugTest={handleDebugTest}
              isRunningTests={isRunningTests}
              onNavigateToTest={handleNavigateToTest}
              onNavigateToLocation={(filePath, line) => openFileAtLocation(filePath, line, 1)}
            />
          )}

          {activeSidebarTab === 'nuget' && (
            <NuGetManager
              projects={currentSolution.projects}
              selectedProject={selectedProject}
              onSelectProject={setSelectedProject}
              onInstallPackage={handleInstallPackage}
              onUninstallPackage={handleUninstallPackage}
            />
          )}

          {activeSidebarTab === 'git' && (
            <GitPanel
              branch={gitBranch}
              isRepo={gitIsRepo}
              changes={
                gitIsRepo
                  ? gitChanges
                  : openFiles
                      .filter(f => dirtyFileIds.has(f.id))
                      .map(f => ({ status: 'M', file: f.relativePath || f.name, fullPath: f.path }))
              }
              onRefresh={() => refreshGitStatus()}
              onOpenChangedFile={(fullPath) => {
                openFileAtLocation(fullPath, 1, 1);
              }}
              onViewDiff={async (fullPath) => {
                const dir = getSolutionDir(currentSolution.path);
                if (window.electronAPI?.gitDiff && dir) {
                  const res = await window.electronAPI.gitDiff(dir, fullPath);
                  setGitDiffPreview({ file: fullPath, diff: res.diff || '(No unstaged textual diff or untracked file)' });
                }
              }}
              onCommit={async (message) => {
                const dir = getSolutionDir(currentSolution.path);
                if (window.electronAPI?.gitCommit && dir && isRealDiskSolution) {
                  const res = await window.electronAPI.gitCommit(dir, message);
                  setTerminalLogs(prev => [
                    ...prev,
                    `\n> git commit -m "${message}"`,
                    ...(res.stdout ? [res.stdout] : []),
                    ...(res.stderr ? [res.stderr] : [])
                  ]);
                  await refreshGitStatus();
                  showNavToast(res.success ? 'Committed Changes' : 'Git Commit Error', message);
                } else {
                  setDirtyFileIds(new Set());
                  showNavToast('Changes Committed', message);
                }
              }}
              activeDiff={gitDiffPreview}
            />
          )}

          {activeSidebarTab === 'search' && (
            <div className="flex-1 p-3 flex flex-col space-y-2 text-xs overflow-hidden">
              <div className="flex items-center justify-between">
                <span className="font-bold text-slate-200">Find in Solution (⌘⇧F)</span>
                {!window.electronAPI?.openSolutionDialog && (
                  <button
                    onClick={() => folderInputRef.current?.click()}
                    className="text-[10px] text-blue-400 hover:underline"
                    title="Load a full project folder in browser preview"
                  >
                    Open Folder
                  </button>
                )}
              </div>
              <input
                type="text"
                value={solutionSearchQuery}
                onChange={(e) => runSolutionSearch(e.target.value)}
                placeholder="Search C# methods, classes, text..."
                className="w-full bg-[#18191c] border border-[#393b40] rounded px-2.5 py-1.5 text-white focus:outline-none focus:border-[#3574f0]"
              />
              <div className="text-[11px] text-gray-500">
                {solutionSearchQuery
                  ? `${solutionSearchResults.length} match(es) in ${currentSolution.name}`
                  : 'Type to search across all files in active solution.'}
              </div>
              <div className="flex-1 overflow-y-auto space-y-1 pr-1">
                {solutionSearchResults.map((res, idx) => (
                  <div
                    key={`${res.file}-${res.line}-${idx}`}
                    onClick={() => {
                      openFileAtLocation(res.file, res.line, res.column);
                    }}
                    className="p-2 rounded bg-[#26282b] hover:bg-[#2b2d30] cursor-pointer border border-[#2b2d30] space-y-0.5"
                  >
                    <div className="flex items-center justify-between text-[11px] font-mono text-blue-400">
                      <span className="truncate">{res.file.split('/').pop()}</span>
                      <span className="text-gray-500 shrink-0">:{res.line}</span>
                    </div>
                    <div className="font-mono text-[11px] text-slate-300 truncate">{res.preview}</div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {activeSidebarTab === 'extensions' && (
            <ExtensionsPanel
              installedExtensions={installedExtensions}
              onInstallExtension={handleInstallExtension}
              onUninstallExtension={handleUninstallExtension}
              onToggleExtension={handleToggleExtension}
              activeEditorTheme={editorTheme}
              onApplyTheme={(theme) => {
                setEditorTheme(theme.id);
                showNavToast('Applied Extension Theme', theme.label);
              }}
            />
          )}
        </div>

        {/* Horizontal Splitter Handle */}
        <div
          onMouseDown={(e) => {
            e.preventDefault();
            const startX = e.clientX;
            const startW = sidebarWidth;
            const onMove = (ev: MouseEvent) => {
              setSidebarWidth(Math.max(200, Math.min(520, startW + (ev.clientX - startX))));
            };
            const onUp = () => {
              window.removeEventListener('mousemove', onMove);
              window.removeEventListener('mouseup', onUp);
            };
            window.addEventListener('mousemove', onMove);
            window.addEventListener('mouseup', onUp);
          }}
          className="w-1 bg-transparent hover:bg-[#3574f0] cursor-col-resize transition-colors shrink-0"
          title="Drag to resize sidebar"
        />

        {/* Center: Editor + Bottom Panels */}
        <div className="flex-1 flex flex-col overflow-hidden min-w-0 min-h-0">
          <div className="flex-1 flex flex-col overflow-hidden min-h-0">
            <CodeEditor
              solution={currentSolution}
              openFiles={openFiles}
              activeFile={activeFile}
              onSelectFile={handleSelectFile}
              onCloseFile={handleCloseFile}
              onContentChange={handleContentChange}
              onSaveFile={handleSaveFile}
              dirtyFileIds={dirtyFileIds}
              breakpoints={breakpoints}
              onToggleBreakpoint={handleToggleBreakpoint}
              pausedLocation={pausedLocation}
              isDebuggingPaused={isDebugging && isPaused}
              onEvaluateDebugExpression={handleEvaluateDebugExpression}
              onExpandDebugVariables={handleExpandDebugVariables}
              onOpenEvaluateModal={handleOpenEvaluateModal}
              onAddWatchExpression={handleAddWatchExpression}
              onSetDebugVariableValue={handleSetDebugVariableValue}
              diagnostics={diagnostics}
              onFindReferences={handleFindReferences}
              onGoToImplementation={handleGoToImplementation}
              onGoToDefinition={handleGoToDefinition}
              onNavigateToFileLocation={(filePath, line, col) => {
                openFileAtLocation(filePath, line, col);
              }}
              onOpenAppSettingsEnv={handleOpenAppSettingsEnv}
              targetFramework={selectedProject?.targetFramework || sdkLabelToTfm(activeSdk)}
              activeLine={activeLine}
              activeColumn={activeColumn}
              navigationNonce={navigationNonce}
              onCursorPositionChange={(ln, col) => {
                currentCursorRef.current = { line: ln, column: col };
              }}
              editorTheme={editorTheme}
              onChangeEditorTheme={setEditorTheme}
              customThemes={customThemes}
              onLocateInExplorer={() => {
                setActiveSidebarTab('explorer');
                setLocateInExplorerNonce(n => n + 1);
              }}
              onCopyAsCurl={(line) => handleGenerateCurlFromLine(line)}
              onCopyExpressionAsJson={handleCopyExpressionAsJson}
              isBottomPanelOpen={isBottomPanelOpen || isDebugging}
              onToggleBottomPanel={() => {
                if (isDebugging) return;
                setIsBottomPanelOpen(prev => !prev);
              }}
            />
          </div>

          {(isDebugging || isBottomPanelOpen) && (
            <div
              onMouseDown={(e) => {
                e.preventDefault();
                const startY = e.clientY;
                const startH = bottomPanelHeight;
                const onMove = (ev: MouseEvent) => {
                  setBottomPanelHeight(Math.max(150, Math.min(540, startH - (ev.clientY - startY))));
                };
                const onUp = () => {
                  window.removeEventListener('mousemove', onMove);
                  window.removeEventListener('mouseup', onUp);
                };
                window.addEventListener('mousemove', onMove);
                window.addEventListener('mouseup', onUp);
              }}
              className="h-1 bg-[#2b2d30] hover:bg-[#3574f0] cursor-row-resize transition-colors shrink-0"
              title="Drag to resize bottom tool window"
            />
          )}

          {isDebugging && (
            <div style={{ height: `${bottomPanelHeight}px` }} className="shrink-0 overflow-hidden">
              <DebugPanel
                isDebugging={isDebugging}
                isPaused={isPaused}
                isRealDiskSolution={isRealDiskSolution}
                missingDebuggerMessage={missingDebuggerMessage}
                onContinue={handleContinue}
                onPause={handlePauseDebug}
                onStepOver={handleStepOver}
                onStepInto={handleStepInto}
                onStepOut={handleStepOut}
                onStop={handleStop}
                onRestart={() => handleDebug()}
                callStack={callStack}
                onSelectFrame={async (frame) => {
                  setSelectedFrameId(frame.id);
                  openFileAtLocation(frame.file, frame.line, frame.column || 1);
                  if (isRealDiskSolution && window.electronAPI?.debugFrameVariables) {
                    const frameVars = await window.electronAPI.debugFrameVariables(frame.id);
                    setVariables(frameVars);
                  }
                }}
                selectedFrameId={selectedFrameId}
                variables={variables}
                onExpandVariable={handleExpandVariable}
                onSetVariableValue={handleSetDebugVariableValue}
                onOpenEvaluateModal={handleOpenEvaluateModal}
                watchExpressions={watchExpressions}
                onAddWatch={handleAddWatchExpression}
                onRemoveWatch={(id) => setWatchExpressions(prev => prev.filter(w => w.id !== id))}
                breakpoints={breakpoints}
                onToggleBreakpointEnabled={handleToggleBreakpointEnabled}
                onRemoveBreakpoint={handleRemoveBreakpoint}
                onNavigateToBreakpoint={handleNavigateToBreakpoint}
                debugOutput={debugLogs}
                onSendTestApiRequest={handleSendTestApiRequest}
                onInstallNetcoredbg={handleInstallNetcoredbg}
                returnValues={returnValues}
                traceHistory={executionTrace}
                onDecompileFrame={handleDecompileFrame}
                onCopyAsCurl={() => handleGenerateCurlFromLine(pausedLocation?.line)}
                onCopyExpressionAsJson={handleCopyExpressionAsJson}
              />
            </div>
          )}

          {isBottomPanelOpen && !isDebugging && (
            <div style={{ height: `${bottomPanelHeight}px` }} className="shrink-0 overflow-hidden">
              <BottomPanel
                isOpen={true}
                onClose={() => setIsBottomPanelOpen(false)}
                activeTab={bottomPanelTab}
                onSelectTab={setBottomPanelTab}
                solutionName={currentSolution.name}
                workspaceDirectory={isRealDiskSolution ? getSolutionDir(currentSolution.path) : undefined}
                terminalLogs={terminalLogs}
                buildLogs={buildLogs}
                debugLogs={debugLogs}
                diagnostics={diagnostics}
                references={references}
                breakpoints={breakpoints}
                callStack={callStack}
                returnValues={returnValues}
                traceHistory={executionTrace}
                selectedFrameId={selectedFrameId}
                onSelectFrame={(frame) => {
                  setSelectedFrameId(frame.id);
                  openFileAtLocation(frame.file, frame.line, frame.column || 1);
                }}
                onDecompileFrame={handleDecompileFrame}
                missingDebuggerMessage={missingDebuggerMessage}
                onInstallNetcoredbg={handleInstallNetcoredbg}
                onNavigateToBreakpoint={handleNavigateToBreakpoint}
                onToggleBreakpointEnabled={handleToggleBreakpointEnabled}
                onRemoveBreakpoint={handleRemoveBreakpoint}
                onExecuteTerminalCommand={handleExecuteTerminalCommand}
                onNavigateToDiagnostic={(d) => {
                  openFileAtLocation(d.file, d.line, d.column);
                }}
                onNavigateToReference={(ref) => {
                  openFileAtLocation(ref.file, ref.line, ref.column);
                }}
                onClearTerminal={() => setTerminalLogs([])}
                activePorts={activePorts}
                isScanningPorts={isScanningPorts}
                configuredPort={resolvedProjectLaunch.port}
                configuredUrl={resolvedProjectLaunch.url}
                configuredPortSource={resolvedProjectLaunch.source}
                onRefreshPorts={refreshActivePorts}
                onKillPortProcess={handleKillPortProcess}
                onOpenPortUrl={(url) => {
                  if (window.electronAPI?.openExternal) {
                    window.electronAPI.openExternal(url);
                  }
                }}
                onSelectCustomPort={(port) => {
                  handleApplyPortConfig({ port, protocol: 'http' });
                }}
              />
            </div>
          )}
        </div>
      </div>

      {/* Modals */}
      <SetupModal
        isOpen={isSetupModalOpen}
        onClose={() => setIsSetupModalOpen(false)}
        setupScriptContent={setupScriptSnippet}
      />

      <QuickOpenModal
        isOpen={isQuickOpenOpen}
        onClose={() => setIsQuickOpenOpen(false)}
        solution={currentSolution}
        onSelectFile={handleSelectFile}
      />

      <SettingsModal
        isOpen={isSettingsOpen}
        onClose={() => setIsSettingsOpen(false)}
        sdkPath={sdkPath}
        onUpdateSdkPath={setSdkPath}
        debuggerPath={debuggerPath}
        onUpdateDebuggerPath={setDebuggerPath}
        activeSdk={activeSdk}
        detectedSdks={detectedSdks}
        onSelectSdk={(sdk) => setActiveSdk(sdk)}
        editorTheme={editorTheme as any}
        onSelectEditorTheme={setEditorTheme}
      />

      <ShortcutsModal
        isOpen={isShortcutsOpen}
        onClose={() => setIsShortcutsOpen(false)}
      />

      <FinderNotification path={finderPath} onClose={() => setFinderPath(null)} />

      <AppSettingsEnvModal
        isOpen={isAppSettingsModalOpen}
        onClose={() => setIsAppSettingsModalOpen(false)}
        file={appSettingsTargetFile}
        project={selectedProject}
        onSyncToLaunchSettings={handleSyncToLaunchSettings}
        onSaveEnvFile={handleSaveEnvFile}
      />

      <ImplementationPickerModal
        isOpen={isImplementationPickerOpen}
        onClose={() => setIsImplementationPickerOpen(false)}
        symbolName={implementationPickerData.symbolName}
        implementations={implementationPickerData.items}
        onSelectImplementation={(item) => {
          const f = findFileByPath(item.file);
          if (f) {
            navigateToLocation(f, item.line, item.column, true);
            showNavToast('Navigated to Symbol', `${item.name} (${f.name}:${item.line})`);
          }
        }}
      />

      <NewFileModal
        isOpen={newFileModalState.isOpen}
        onClose={() => setNewFileModalState({ isOpen: false, project: null })}
        project={newFileModalState.project}
        folderRelativePath={newFileModalState.folderRelativePath}
        onCreateFile={handleCreateNewFile}
      />

      <EvaluateExpressionModal
        isOpen={evaluateModalState.isOpen}
        initialExpression={evaluateModalState.expression}
        initialMode={evaluateModalState.mode}
        variables={variables}
        onClose={() => setEvaluateModalState(prev => ({ ...prev, isOpen: false }))}
        onEvaluate={handleEvaluateDebugExpression}
        onExpandVariables={handleExpandDebugVariables}
        onAddWatch={handleAddWatchExpression}
        onSetValue={handleSetDebugVariableValue}
      />

      <CurlPreviewModal
        isOpen={curlModalState.isOpen}
        onClose={() => setCurlModalState(prev => ({ ...prev, isOpen: false }))}
        curlData={curlModalState.curlData}
        detectedCall={curlModalState.detectedCall}
        isGenerating={curlModalState.isGenerating}
        error={curlModalState.error}
      />

      <PortConfigModal
        isOpen={portModalState.isOpen}
        onClose={() => setPortModalState({ isOpen: false, pendingLaunchMode: null })}
        project={selectedProject}
        currentOverride={currentPortOverride}
        activePorts={activePorts}
        isScanningPorts={isScanningPorts}
        isElectron={Boolean(window.electronAPI?.isElectron)}
        pendingLaunchMode={portModalState.pendingLaunchMode}
        onRefreshPorts={refreshActivePorts}
        onApplyPortConfig={handleApplyPortConfig}
        onSavePortToLaunchSettings={handleSavePortToLaunchSettings}
        onKillProcess={handleKillPortProcess}
        onLaunchAfterResolve={handleLaunchAfterPortResolve}
        onOpenUrl={(url) => {
          if (window.electronAPI?.openExternal) {
            window.electronAPI.openExternal(url);
          }
        }}
      />

      {navNotification && (
        <div className="fixed top-14 right-6 z-50 bg-[#26282b] border border-[#3574f0] rounded-xl px-4 py-2.5 shadow-2xl flex items-center space-x-3 text-xs text-white animate-in slide-in-from-top duration-150">
          <div className="w-6 h-6 rounded-lg bg-blue-500/20 text-blue-400 flex items-center justify-center shrink-0">
            <span className="font-bold text-xs">MR</span>
          </div>
          <div className="space-y-0.5">
            <div className="font-semibold text-slate-100">{navNotification.message}</div>
            {navNotification.sub && (
              <div className="text-[11px] text-gray-400 font-mono">{navNotification.sub}</div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
