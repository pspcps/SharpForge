// Electron Preload Script with Context Isolation
// Exposes secure, scoped APIs to the renderer window via contextBridge.

try {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { contextBridge, ipcRenderer } = require('electron');

  contextBridge.exposeInMainWorld('electronAPI', {
    openSolutionDialog: () => ipcRenderer.invoke('dialog:open-solution'),
    revealInFinder: (filePath: string) => ipcRenderer.invoke('shell:reveal-in-finder', filePath),
    detectSdks: () => ipcRenderer.invoke('dotnet:detect-sdks'),
    restoreSolution: (path: string) => ipcRenderer.invoke('dotnet:restore', path),
    buildSolution: (path: string, config: string) => ipcRenderer.invoke('dotnet:build', path, config),
    cleanSolution: (path: string) => ipcRenderer.invoke('dotnet:clean', path),
    runProject: (csprojPath: string, profile?: string) => ipcRenderer.invoke('dotnet:run', csprojPath, profile),
    stopProcess: (processId: string) => ipcRenderer.invoke('dotnet:stop', processId),
    runTests: (solutionPath: string, filter?: string) => ipcRenderer.invoke('dotnet:test', solutionPath, filter),
    startDebugger: (targetDll: string, args?: string[]) => ipcRenderer.invoke('dap:start', targetDll, args),
    debuggerCommand: (command: string, args?: any) => ipcRenderer.invoke('dap:command', command, args),
    stopDebugger: () => ipcRenderer.invoke('dap:stop'),
    onTerminalOutput: (callback: (data: string) => void) => {
      const handler = (_: any, data: string) => callback(data);
      ipcRenderer.on('terminal:output', handler);
      return () => ipcRenderer.removeListener('terminal:output', handler);
    },
    onDebugOutput: (callback: (data: any) => void) => {
      const handler = (_: any, data: any) => callback(data);
      ipcRenderer.on('debug:output', handler);
      return () => ipcRenderer.removeListener('debug:output', handler);
    },
    onLspDiagnostics: (callback: (data: any) => void) => {
      const handler = (_: any, data: any) => callback(data);
      ipcRenderer.on('lsp:diagnostics', handler);
      return () => ipcRenderer.removeListener('lsp:diagnostics', handler);
    }
  });
} catch {
  // Running in standard browser / web mode without electron bridge
}
