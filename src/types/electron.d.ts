// Ambient type definitions for Electron APIs to ensure seamless compilation
// in web preview and desktop packaging workflows.
import type { ActivePortProcess, MarketplaceExtension, RecentSolutionEntry, SolutionFile } from './minirider';

export interface GitChangeItem {
  status: string;
  file: string;
  fullPath: string;
}

export interface GitStatusResult {
  isRepo: boolean;
  repoRoot?: string;
  branch: string;
  changes: GitChangeItem[];
}

export interface ResolvedAssemblyInfo {
  name: string;
  version?: string;
  dllPath: string;
  source: 'project' | 'nuget' | 'framework';
}

export interface DecompileDllResult {
  success: boolean;
  dllPath: string;
  assemblyName: string;
  typeName?: string;
  source: string;
  engine: 'ilspycmd' | 'dotnet-metadata' | 'pe-reader';
  types?: string[];
  error?: string;
}

export interface IElectronAPI {
  isElectron?: boolean;
  openSolutionDialog: () => Promise<SolutionFile | null>;
  openFolderDialog?: () => Promise<SolutionFile | null>;
  loadSolution: (filePath: string) => Promise<SolutionFile>;
  recentSolutionsList?: () => Promise<RecentSolutionEntry[]>;
  recentSolutionsAdd?: (entry: { name: string; path: string; format: 'sln' | 'slnx'; projectCount?: number }) => Promise<RecentSolutionEntry[]>;
  recentSolutionsRemove?: (solutionPath: string) => Promise<RecentSolutionEntry[]>;
  recentSolutionsClear?: () => Promise<RecentSolutionEntry[]>;
  restoreSolution?: (slnPath: string) => Promise<{
    success: boolean;
    stdout: string;
    stderr: string;
    code: number;
    solution?: SolutionFile;
  }>;
  readFile?: (filePath: string) => Promise<{ success: boolean; content?: string; error?: string }>;
  saveFile: (filePath: string, content: string) => Promise<{ success: boolean; error?: string }>;
  createFile?: (filePath: string, content: string) => Promise<{ success: boolean; filePath?: string; error?: string }>;
  deleteFile?: (filePath: string) => Promise<{ success: boolean; error?: string }>;
  renameFile?: (oldPath: string, newPath: string) => Promise<{ success: boolean; newPath?: string; error?: string }>;
  revealInFinder: (filePath: string) => Promise<void>;
  openExternal?: (url: string) => Promise<boolean>;
  checkProject?: (targetPath: string) => Promise<{ success: boolean; stdout: string; stderr: string; code: number }>;
  detectSdks: () => Promise<{ current: string; sdks: string[]; runtimes?: string[] }>;
  runCommand: (command: string, cwd?: string) => Promise<{ success: boolean; stdout: string; stderr: string; code: number }>;
  runTests?: (options: {
    targetPath: string;
    cwd?: string;
    filter?: string;
    configuration?: 'Debug' | 'Release';
  }) => Promise<{
    success: boolean;
    stdout: string;
    stderr: string;
    code: number;
    trxContents: Array<{ fileName: string; xml: string }>;
  }>;
  spawnProcess?: (
    command: string,
    cwd?: string,
    extraEnv?: Record<string, string>
  ) => Promise<{ success: boolean; processId?: string; error?: string }>;
  stopProcess?: (processId?: string) => Promise<boolean>;
  portsList?: () => Promise<{ success: boolean; ports: ActivePortProcess[]; error?: string }>;
  portsCheck?: (port: number) => Promise<{ inUse: boolean; processes: ActivePortProcess[] }>;
  portsKill?: (options: {
    pid?: number;
    port?: number;
    force?: boolean;
  }) => Promise<{ success: boolean; killedPids: number[]; error?: string }>;
  checkNetcoredbg?: (customPath?: string) => Promise<{ available: boolean; path: string | null }>;
  installNetcoredbg?: () => Promise<{ success: boolean; path: string | null; output?: string; error?: string }>;
  debugStart?: (options: {
    projectPath: string;
    buildConfig: 'Debug' | 'Release';
    targetFramework: string;
    debuggerPath?: string;
    customPort?: number;
    customUrl?: string;
    breakpoints: Array<{ filePath: string; line: number; enabled: boolean }>;
  }) => Promise<{
    success: boolean;
    missingDebugger?: boolean;
    buildFailed?: boolean;
    buildOutput?: string;
    dllPath?: string;
    netcoredbgPath?: string;
    applicationUrl?: string;
    error?: string;
  }>;
  debugSetBreakpoints?: (filePath: string, lines: number[]) => Promise<any[]>;
  debugContinue?: () => Promise<boolean>;
  debugPause?: () => Promise<boolean>;
  debugStepOver?: () => Promise<boolean>;
  debugStepInto?: () => Promise<boolean>;
  debugStepOut?: () => Promise<boolean>;
  debugFrameVariables?: (frameId: number) => Promise<Array<{ name: string; value: string; type: string; scope?: string; variablesReference?: number; parentVariablesReference?: number }>>;
  debugVariables?: (variablesReference: number) => Promise<Array<{ name: string; value: string; type: string; scope?: string; variablesReference?: number; parentVariablesReference?: number }>>;
  debugEvaluate?: (
    expression: string,
    frameId?: number,
    context?: 'hover' | 'watch' | 'repl'
  ) => Promise<{ success: boolean; result: string; type?: string; variablesReference?: number }>;
  debugSetVariable?: (payload: {
    variablesReference?: number;
    name?: string;
    expression?: string;
    value: string;
    frameId?: number;
  }) => Promise<{ success: boolean; value?: string; type?: string; variablesReference?: number; error?: string }>;
  debugStop?: () => Promise<boolean>;
  decompileCheckIlspy?: () => Promise<{ available: boolean; path: string | null }>;
  decompileInstallIlspy?: () => Promise<{ success: boolean; path: string | null; output?: string; error?: string }>;
  decompileResolveAssemblies?: (projectPath: string, targetFramework?: string) => Promise<ResolvedAssemblyInfo[]>;
  decompilePickDll?: () => Promise<string | null>;
  decompileDll?: (options: {
    dllPath?: string;
    packageId?: string;
    packageVersion?: string;
    projectPath?: string;
    targetFramework?: string;
    typeName?: string;
  }) => Promise<DecompileDllResult>;
  decompileFindSymbol?: (options: {
    symbolName: string;
    projectPath: string;
    targetFramework?: string;
  }) => Promise<DecompileDllResult | null>;
  extensionsSearch?: (query: string, source?: 'all' | 'vscode' | 'jetbrains') => Promise<MarketplaceExtension[]>;
  extensionsListInstalled?: () => Promise<MarketplaceExtension[]>;
  extensionsInstall?: (ext: MarketplaceExtension) => Promise<{ success: boolean; extension?: MarketplaceExtension; error?: string }>;
  extensionsUninstall?: (id: string) => Promise<{ success: boolean; error?: string }>;
  extensionsToggleEnabled?: (id: string, enabled: boolean) => Promise<{ success: boolean; extensions?: MarketplaceExtension[] }>;
  gitStatus?: (repoDir: string) => Promise<GitStatusResult>;
  gitDiff?: (repoDir: string, filePath: string) => Promise<{ success: boolean; diff: string }>;
  gitCommit?: (repoDir: string, message: string, files?: string[]) => Promise<{ success: boolean; stdout: string; stderr: string }>;
  onSolutionOpened?: (callback: (solution: SolutionFile) => void) => () => void;
  onMenuAction?: (channel: string, callback: (...args: any[]) => void) => () => void;
  onProcessOutput?: (callback: (data: { processId: string; stream: 'stdout' | 'stderr'; text: string }) => void) => () => void;
  onProcessExit?: (callback: (data: { processId: string; code: number }) => void) => () => void;
  onDebugEvent?: (callback: (data: any) => void) => () => void;
}

declare global {
  interface Window {
    electronAPI?: IElectronAPI;
  }
}
