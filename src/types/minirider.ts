export interface SolutionFile {
  name: string;
  path: string;
  format: 'sln' | 'slnx';
  projects: ProjectItem[];
}

export interface ProjectItem {
  id: string;
  name: string;
  path: string;
  targetFramework: string;
  targetFrameworks?: string[];
  projectType: 'webapi' | 'classlib' | 'test' | 'console';
  dependencies: {
    frameworks: string[];
    packages: NuGetPackage[];
    projectReferences: string[];
  };
  files: SolutionFileItem[];
  launchSettings?: LaunchSettings;
}

export interface NuGetPackage {
  id: string;
  version: string;
  resolvedVersion?: string;
  isDirect: boolean;
}

export interface SolutionFileItem {
  id: string;
  name: string;
  path: string;
  relativePath: string;
  extension: string;
  isDirectory: boolean;
  children?: SolutionFileItem[];
  content?: string;
  isReadOnly?: boolean;
  isDecompiled?: boolean;
  assemblyName?: string;
  assemblyPath?: string;
}

export interface LaunchSettings {
  profiles: Record<string, {
    commandName: string;
    dotnetRunMessages?: boolean;
    launchBrowser?: boolean;
    applicationUrl?: string;
    environmentVariables?: Record<string, string>;
  }>;
}

export interface Breakpoint {
  id: string;
  filePath: string;
  line: number;
  condition?: string;
  enabled: boolean;
  hitCount?: number;
}

export interface ReturnValueEntry {
  id: string;
  functionName: string;
  returnType: string;
  value: string;
  file: string;
  line: number;
  timestamp: string;
}

export interface StackFrame {
  id: number;
  name: string;
  file: string;
  line: number;
  column: number;
  isExternal?: boolean;
  parameters?: VariableItem[];
  localsSnapshot?: VariableItem[];
  returnValue?: {
    value: string;
    type: string;
    expression?: string;
  };
}

export interface ExecutionTraceStep {
  id: string;
  stepNumber: number;
  functionName: string;
  shortName: string;
  file: string;
  line: number;
  reason: string;
  timestamp: string;
  parameters: VariableItem[];
  locals: VariableItem[];
  returnValue?: ReturnValueEntry;
}

export interface VariableItem {
  name: string;
  value: string;
  type: string;
  scope?: string;
  variablesReference?: number;
  parentVariablesReference?: number;
  children?: VariableItem[];
}

export interface TestItem {
  id: string;
  projectName: string;
  namespace: string;
  className: string;
  methodName: string;
  fullName: string;
  status: 'passed' | 'failed' | 'running' | 'idle' | 'skipped';
  durationMs?: number;
  errorMessage?: string;
  stackTrace?: string;
  skipReason?: string;
  standardOutput?: string;
  expectedValue?: string;
  actualValue?: string;
  filePath?: string;
  line?: number;
  lastRunAt?: string;
  framework?: 'xUnit' | 'NUnit' | 'MSTest' | 'Unknown';
}

export interface ReferenceItem {
  file: string;
  line: number;
  column: number;
  preview: string;
}

export interface ImplementationItem {
  name: string;
  kind: 'class' | 'method' | 'property' | 'interface';
  file: string;
  line: number;
  column: number;
  preview: string;
  containerName?: string;
}

export interface DiagnosticItem {
  id: string;
  code: string;
  message: string;
  file: string;
  line: number;
  column: number;
  severity: 'error' | 'warning' | 'info';
  source: 'Roslyn' | 'MSBuild' | 'Compiler';
}

export interface DotnetSdkInfo {
  version: string;
  sdks: string[];
  runtimes: string[];
  architecture: 'arm64' | 'x64';
  os: 'macOS Sonoma' | 'macOS Sequoia' | 'macOS Ventura' | 'macOS';
}

export interface MarketplaceExtension {
  id: string;
  name: string;
  displayName: string;
  publisher: string;
  version: string;
  description: string;
  source: 'vscode' | 'jetbrains' | 'builtin';
  downloadUrl?: string;
  homepageUrl?: string;
  downloads?: number;
  rating?: number;
  categories?: string[];
  iconUrl?: string;
  installed?: boolean;
  enabled?: boolean;
  installedPath?: string;
  themes?: Array<{ id: string; label: string; uiTheme?: string; path?: string; colors?: Record<string, string>; rules?: Array<{ token: string; foreground?: string; fontStyle?: string }> }>;
}

export interface ActivePortProcess {
  port: number;
  pid: number;
  processName: string;
  protocol: string;
  address: string;
  user?: string;
  commandLine?: string;
  isDotnet?: boolean;
}

export interface ProjectPortConfig {
  port: number | null;
  protocol: 'http' | 'https';
}

export interface RecentSolutionEntry {
  name: string;
  path: string;
  format: 'sln' | 'slnx';
  lastOpened: string;
  projectCount?: number;
  exists?: boolean;
}


