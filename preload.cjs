const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  isElectron: true,
  fileHistory: file => ipcRenderer.invoke('history:list', file),
  terminalList: cwd => ipcRenderer.invoke('terminal:list', cwd),
  terminalCreate: options => ipcRenderer.invoke('terminal:create', options),
  terminalWrite: (id, data) => ipcRenderer.invoke('terminal:write', id, data),
  terminalResize: (id, cols, rows) => ipcRenderer.invoke('terminal:resize', id, cols, rows),
  terminalClose: id => ipcRenderer.invoke('terminal:close', id),
  onTerminalEvent: callback => {
    const handler = (_, data) => callback(data);
    ipcRenderer.on('terminal:event', handler);
    return () => ipcRenderer.removeListener('terminal:event', handler);
  },
  openSolutionDialog: () => ipcRenderer.invoke('dialog:open-solution'),
  openFolderDialog: () => ipcRenderer.invoke('dialog:open-folder'),
  loadSolution: (filePath) => ipcRenderer.invoke('solution:load-from-path', filePath),
  recentSolutionsList: () => ipcRenderer.invoke('recent:list'),
  recentSolutionsAdd: (entry) => ipcRenderer.invoke('recent:add', entry),
  recentSolutionsRemove: (solutionPath) => ipcRenderer.invoke('recent:remove', solutionPath),
  recentSolutionsClear: () => ipcRenderer.invoke('recent:clear'),
  restoreSolution: (slnPath) => ipcRenderer.invoke('dotnet:restore-solution', slnPath),
  readFile: (filePath) => ipcRenderer.invoke('fs:read-file', filePath),
  saveFile: (filePath, content) => ipcRenderer.invoke('fs:save-file', filePath, content),
  createFile: (filePath, content) => ipcRenderer.invoke('fs:create-file', filePath, content),
  deleteFile: (filePath) => ipcRenderer.invoke('fs:delete-file', filePath),
  renameFile: (oldPath, newPath) => ipcRenderer.invoke('fs:rename-file', oldPath, newPath),
  detectSdks: () => ipcRenderer.invoke('dotnet:detect-sdks'),
  revealInFinder: (filePath) => ipcRenderer.invoke('shell:reveal-in-finder', filePath),
  openExternal: (url) => ipcRenderer.invoke('shell:open-external', url),
  checkProject: (targetPath) => ipcRenderer.invoke('dotnet:check-project', targetPath),
  runCommand: (command, cwd) => ipcRenderer.invoke('dotnet:run-command', command, cwd),
  runTests: (options) => ipcRenderer.invoke('dotnet:run-tests', options),
  spawnProcess: (command, cwd, extraEnv) => ipcRenderer.invoke('dotnet:spawn-process', command, cwd, extraEnv),
  stopProcess: (processId) => ipcRenderer.invoke('dotnet:stop-process', processId),
  portsList: () => ipcRenderer.invoke('ports:list'),
  portsCheck: (port) => ipcRenderer.invoke('ports:check', port),
  portsKill: (options) => ipcRenderer.invoke('ports:kill', options),
  checkNetcoredbg: (customPath) => ipcRenderer.invoke('debug:check-netcoredbg', customPath),
  installNetcoredbg: () => ipcRenderer.invoke('debug:install-netcoredbg'),
  debugStart: (options) => ipcRenderer.invoke('debug:start', options),
  debugSetBreakpoints: (filePath, lines) => ipcRenderer.invoke('debug:set-breakpoints', filePath, lines),
  debugContinue: () => ipcRenderer.invoke('debug:continue'),
  debugPause: () => ipcRenderer.invoke('debug:pause'),
  debugStepOver: () => ipcRenderer.invoke('debug:step-over'),
  debugStepInto: () => ipcRenderer.invoke('debug:step-into'),
  debugStepOut: () => ipcRenderer.invoke('debug:step-out'),
  debugFrameVariables: (frameId) => ipcRenderer.invoke('debug:frame-variables', frameId),
  debugVariables: (variablesReference) => ipcRenderer.invoke('debug:variables', variablesReference),
  debugEvaluate: (expression, frameId, context) => ipcRenderer.invoke('debug:evaluate', expression, frameId, context),
  debugSetVariable: (payload) => ipcRenderer.invoke('debug:set-variable', payload),
  debugStop: () => ipcRenderer.invoke('debug:stop'),
  decompileCheckIlspy: () => ipcRenderer.invoke('decompile:check-ilspy'),
  decompileInstallIlspy: () => ipcRenderer.invoke('decompile:install-ilspy'),
  decompileResolveAssemblies: (projectPath, targetFramework) => ipcRenderer.invoke('decompile:resolve-assemblies', projectPath, targetFramework),
  decompilePickDll: () => ipcRenderer.invoke('decompile:pick-dll'),
  decompileDll: (options) => ipcRenderer.invoke('decompile:dll', options),
  decompileFindSymbol: (options) => ipcRenderer.invoke('decompile:find-symbol', options),
  extensionsSearch: (query, source) => ipcRenderer.invoke('extensions:search', query, source),
  extensionsListInstalled: () => ipcRenderer.invoke('extensions:list'),
  extensionsInstall: (ext) => ipcRenderer.invoke('extensions:install', ext),
  extensionsUninstall: (id) => ipcRenderer.invoke('extensions:uninstall', id),
  extensionsToggleEnabled: (id, enabled) => ipcRenderer.invoke('extensions:toggle', id, enabled),
  gitStatus: (repoDir) => ipcRenderer.invoke('git:status', repoDir),
  gitDiff: (repoDir, filePath) => ipcRenderer.invoke('git:diff', repoDir, filePath),
  gitCommit: (repoDir, message, files) => ipcRenderer.invoke('git:commit', repoDir, message, files),

  onSolutionOpened: (callback) => {
    const handler = (_, solution) => callback(solution);
    ipcRenderer.on('solution:opened', handler);
    return () => ipcRenderer.removeListener('solution:opened', handler);
  },

  onMenuAction: (channel, callback) => {
    const handler = (_, ...args) => callback(...args);
    ipcRenderer.on(channel, handler);
    return () => ipcRenderer.removeListener(channel, handler);
  },

  onProcessOutput: (callback) => {
    const handler = (_, data) => callback(data);
    ipcRenderer.on('process:output', handler);
    return () => ipcRenderer.removeListener('process:output', handler);
  },

  onProcessExit: (callback) => {
    const handler = (_, data) => callback(data);
    ipcRenderer.on('process:exit', handler);
    return () => ipcRenderer.removeListener('process:exit', handler);
  },

  onDebugEvent: (callback) => {
    const handler = (_, data) => callback(data);
    ipcRenderer.on('debug:event', handler);
    return () => ipcRenderer.removeListener('debug:event', handler);
  }
});
