import * as path from 'path';
import { SolutionManager } from './solution-manager';
import { DotnetManager } from './dotnet-manager';
import { DebuggerManager } from './debugger-manager';
import { LanguageServerManager } from './language-server';
import { TestRunner } from './test-runner';

// Dynamically load electron in desktop runtime
let electron: any;
try {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  electron = require('electron');
} catch {
  // Desktop runtime will have electron available
}

const app = electron?.app;
const BrowserWindow = electron?.BrowserWindow;
const dialog = electron?.dialog;
const shell = electron?.shell;
const ipcMain = electron?.ipcMain;
const Menu = electron?.Menu;

let mainWindow: any = null;
const solutionManager = new SolutionManager();
const dotnetManager = new DotnetManager();
const debuggerManager = new DebuggerManager();
const languageServer = new LanguageServerManager();
const testRunner = new TestRunner();

function createWindow() {
  if (!BrowserWindow) return;

  mainWindow = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1024,
    minHeight: 700,
    title: 'SharpForge',
    titleBarStyle: 'hiddenInset', // macOS native traffic light titlebar
    trafficLightPosition: { x: 16, y: 14 },
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    },
    backgroundColor: '#1e1e24'
  });

  const isDev = process.env.NODE_ENV === 'development';
  if (isDev) {
    mainWindow.loadURL('http://localhost:3000');
  } else {
    mainWindow.loadFile(path.join(__dirname, '../renderer/index.html'));
  }

  setupMenu();
}

function setupMenu() {
  if (!Menu) return;
  const template = [
    {
      label: 'SharpForge',
      submenu: [
        { role: 'about' },
        { type: 'separator' },
        { role: 'services' },
        { type: 'separator' },
        { role: 'hide' },
        { role: 'hideOthers' },
        { role: 'unhide' },
        { type: 'separator' },
        { role: 'quit' }
      ]
    },
    {
      label: 'File',
      submenu: [
        {
          label: 'Open Solution...',
          accelerator: 'CmdOrCtrl+O',
          click: async () => {
            const result = await dialog.showOpenDialog(mainWindow, {
              properties: ['openFile'],
              filters: [{ name: '.NET Solution', extensions: ['sln', 'slnx'] }]
            });
            if (!result.canceled && result.filePaths.length > 0) {
              const sol = await solutionManager.loadSolution(result.filePaths[0]);
              mainWindow.webContents.send('solution:opened', sol);
            }
          }
        },
        { type: 'separator' },
        { role: 'close' }
      ]
    },
    {
      label: 'Build',
      submenu: [
        {
          label: 'Build Solution',
          accelerator: 'CmdOrCtrl+Shift+B',
          click: () => mainWindow.webContents.send('action:build')
        },
        {
          label: 'Run Startup Project',
          accelerator: 'CmdOrCtrl+R',
          click: () => mainWindow.webContents.send('action:run')
        }
      ]
    },
    {
      label: 'Debug',
      submenu: [
        {
          label: 'Start Debugging',
          accelerator: 'F5',
          click: () => mainWindow.webContents.send('action:debug')
        },
        {
          label: 'Toggle Breakpoint',
          accelerator: 'F9',
          click: () => mainWindow.webContents.send('action:toggle-breakpoint')
        },
        {
          label: 'Step Over',
          accelerator: 'F10',
          click: () => mainWindow.webContents.send('action:step-over')
        },
        {
          label: 'Step Into',
          accelerator: 'F11',
          click: () => mainWindow.webContents.send('action:step-into')
        },
        {
          label: 'Step Out',
          accelerator: 'Shift+F11',
          click: () => mainWindow.webContents.send('action:step-out')
        },
        {
          label: 'Stop',
          accelerator: 'Shift+F5',
          click: () => mainWindow.webContents.send('action:stop')
        }
      ]
    },
    {
      label: 'View',
      submenu: [
        { role: 'reload' },
        { role: 'forceReload' },
        { role: 'toggleDevTools' },
        { type: 'separator' },
        { role: 'togglefullscreen' }
      ]
    }
  ];

  const menu = Menu.buildFromTemplate(template);
  Menu.setApplicationMenu(menu);
}

function registerIpcHandlers() {
  if (!ipcMain) return;

  ipcMain.handle('dialog:open-solution', async () => {
    const result = await dialog.showOpenDialog(mainWindow, {
      properties: ['openFile'],
      filters: [{ name: '.NET Solution', extensions: ['sln', 'slnx'] }]
    });
    if (!result.canceled && result.filePaths.length > 0) {
      return result.filePaths[0];
    }
    return null;
  });

  ipcMain.handle('shell:reveal-in-finder', async (_: any, filePath: string) => {
    if (shell) {
      shell.showItemInFolder(filePath);
    }
  });

  ipcMain.handle('dotnet:detect-sdks', async () => {
    return dotnetManager.detectSdks();
  });

  ipcMain.handle('dotnet:restore', async (_: any, solPath: string) => {
    return dotnetManager.restore(solPath, {
      onStdout: data => mainWindow?.webContents.send('terminal:output', data),
      onStderr: data => mainWindow?.webContents.send('terminal:output', data)
    });
  });

  ipcMain.handle('dotnet:build', async (_: any, solPath: string, config: 'Debug' | 'Release') => {
    return dotnetManager.build(solPath, config, false, {
      onStdout: data => mainWindow?.webContents.send('terminal:output', data),
      onStderr: data => mainWindow?.webContents.send('terminal:output', data)
    });
  });

  ipcMain.handle('dotnet:clean', async (_: any, solPath: string) => {
    return dotnetManager.clean(solPath, {
      onStdout: data => mainWindow?.webContents.send('terminal:output', data),
      onStderr: data => mainWindow?.webContents.send('terminal:output', data)
    });
  });

  ipcMain.handle('dotnet:run', async (_: any, csprojPath: string, profile?: string) => {
    const procId = `run-${Date.now()}`;
    dotnetManager.runProject(csprojPath, procId, profile, {}, {
      onStdout: data => mainWindow?.webContents.send('terminal:output', data),
      onStderr: data => mainWindow?.webContents.send('terminal:output', data),
      onExit: code => mainWindow?.webContents.send('terminal:output', `\nProcess finished with exit code ${code}\n`)
    });
    return procId;
  });

  ipcMain.handle('dotnet:stop', async (_: any, procId: string) => {
    return dotnetManager.stopProcess(procId);
  });

  ipcMain.handle('dotnet:test', async (_: any, solPath: string, filter?: string) => {
    return testRunner.runTests(solPath, filter, test => {
      mainWindow?.webContents.send('test:update', test);
    });
  });

  // DAP Debugger IPC
  ipcMain.handle('dap:start', async (_: any, targetDll: string, args: string[]) => {
    debuggerManager.on('output', out => mainWindow?.webContents.send('debug:output', out));
    debuggerManager.on('stopped', stopInfo => mainWindow?.webContents.send('debug:stopped', stopInfo));
    debuggerManager.on('continued', () => mainWindow?.webContents.send('debug:continued'));
    debuggerManager.on('terminated', term => mainWindow?.webContents.send('debug:terminated', term));
    await debuggerManager.startSession(targetDll, args);
  });

  ipcMain.handle('dap:command', async (_: any, command: string, args?: any) => {
    switch (command) {
      case 'continue': return debuggerManager.continue();
      case 'next': return debuggerManager.next();
      case 'stepIn': return debuggerManager.stepIn();
      case 'stepOut': return debuggerManager.stepOut();
      case 'stackTrace': return debuggerManager.getStackTrace(args?.threadId);
      case 'variables': return debuggerManager.getScopesAndVariables(args?.frameId);
      case 'evaluate': return debuggerManager.evaluateExpression(args?.expression, args?.frameId);
      case 'setBreakpoints': return debuggerManager.setBreakpoints(args?.filePath, args?.breakpoints);
      default: throw new Error(`Unknown debugger command: ${command}`);
    }
  });

  ipcMain.handle('dap:stop', async () => {
    await debuggerManager.stop();
  });
}

if (app) {
  app.whenReady().then(() => {
    registerIpcHandlers();
    createWindow();

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
  });

  // macOS Finder open event (e.g. user double-clicks MyApp.sln in Finder)
  app.on('open-file', async (event: any, filePath: string) => {
    event.preventDefault();
    if (filePath.endsWith('.sln') || filePath.endsWith('.slnx')) {
      const sol = await solutionManager.loadSolution(filePath);
      mainWindow?.webContents.send('solution:opened', sol);
    }
  });

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
      app.quit();
    }
  });
}
