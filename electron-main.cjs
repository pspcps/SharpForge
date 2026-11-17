const { app, BrowserWindow, dialog, shell, ipcMain, Menu } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { exec, execFile } = require('child_process');
const { isTrustedSender } = require('./desktop/security.cjs');
// Every privileged operation must originate in this app's main frame.
const registerHandler = ipcMain.handle.bind(ipcMain);
const trustedDirectories = new Set();
ipcMain.handle = (channel, handler) => registerHandler(channel, async (event, ...args) => {
  if (!isTrustedSender(event, mainWindow, !app.isPackaged)) throw new Error('Untrusted IPC sender');
  if (/^(dotnet:|debug:start|git:commit|terminal:create)/.test(channel)) {
    const candidate = channel === 'terminal:create' ? args[0]?.cwd : channel === 'git:commit' ? args[0] : channel === 'debug:start' ? args[0]?.projectPath : typeof args[1] === 'string' ? args[1] : typeof args[0] === 'string' ? path.dirname(args[0]) : args[0]?.cwd;
    const root = path.resolve(candidate || process.cwd());
    if (!trustedDirectories.has(root)) {
      const answer = await dialog.showMessageBox(mainWindow, { type: 'warning', buttons: ['Cancel', 'Trust for this session'], defaultId: 0, cancelId: 0, message: 'Allow project code and commands to execute?', detail: 'Builds, restores, tests and debugging can run code with your account permissions. Only continue for projects you trust.\n' + root });
      if (answer.response !== 1) throw new Error('Execution cancelled: workspace is not trusted');
      trustedDirectories.add(root);
    }
  }
  return handler(event, ...args);
});

// =============================================================================
// Centralized Logging System (saved live to ~/sharpforge-logs)
// =============================================================================
const LOG_DIR = path.join(os.homedir(), 'sharpforge-logs');
try {
  if (!fs.existsSync(LOG_DIR)) {
    fs.mkdirSync(LOG_DIR, { recursive: true });
  }
} catch (e) {
  // Ignore permission error
}

const APP_LOG = path.join(LOG_DIR, 'app.log');
const ERROR_LOG = path.join(LOG_DIR, 'error.log');
const ELECTRON_LOG = path.join(LOG_DIR, 'electron.log');

function writeLog(filePath, level, message) {
  const timestamp = new Date().toISOString();
  const line = `[${timestamp}] [${level}] ${message}\n`;
  try {
    fs.appendFileSync(filePath, line);
  } catch (err) {
    // Fallback
  }
}

function logInfo(msg) {
  console.log(`[SharpForge] ${msg}`);
  writeLog(APP_LOG, 'INFO', msg);
  writeLog(ELECTRON_LOG, 'INFO', msg);
}

function logWarn(msg) {
  console.warn(`[SharpForge WARN] ${msg}`);
  writeLog(APP_LOG, 'WARN', msg);
  writeLog(ELECTRON_LOG, 'WARN', msg);
}

function logError(msg, err) {
  const errMsg = err ? `${msg}\n${err.stack || err}` : msg;
  console.error(`[SharpForge ERROR] ${errMsg}`);
  writeLog(APP_LOG, 'ERROR', errMsg);
  writeLog(ERROR_LOG, 'ERROR', errMsg);
}

/**
 * macOS Finder-launched .app bundles do not inherit ~/.zshrc PATH.
 * Augment PATH so `dotnet`, `git`, `netcoredbg`, and Homebrew tools resolve reliably.
 */
function resolveDotnetRoot(mergedPath) {
  if (process.env.DOTNET_ROOT && fs.existsSync(process.env.DOTNET_ROOT)) {
    return process.env.DOTNET_ROOT;
  }
  const home = os.homedir();
  const candidates = [
    path.join(home, '.dotnet', 'dotnet'),
    '/usr/local/share/dotnet/dotnet',
    '/opt/homebrew/opt/dotnet/libexec/dotnet',
    '/opt/homebrew/bin/dotnet',
    '/usr/local/bin/dotnet'
  ];
  for (const dir of mergedPath.split(':')) {
    if (dir) candidates.push(path.join(dir, 'dotnet'));
  }
  for (const bin of candidates) {
    try {
      if (fs.existsSync(bin)) {
        const real = fs.realpathSync(bin);
        const dir = path.dirname(real);
        if (fs.existsSync(path.join(dir, 'host')) || fs.existsSync(path.join(dir, 'shared')) || fs.existsSync(path.join(dir, 'sdk'))) {
          return dir;
        }
      }
    } catch (_) {}
  }
  return fs.existsSync('/opt/homebrew/opt/dotnet/libexec')
    ? '/opt/homebrew/opt/dotnet/libexec'
    : '/usr/local/share/dotnet';
}

function getEnhancedEnv() {
  const home = os.homedir();
  const extraPaths = [
    '/usr/local/share/dotnet',
    '/opt/homebrew/bin',
    '/opt/homebrew/sbin',
    '/usr/local/bin',
    path.join(home, '.dotnet'),
    path.join(home, '.dotnet', 'tools'),
    '/usr/bin',
    '/bin',
    '/usr/sbin',
    '/sbin'
  ];
  const currentPath = process.env.PATH || '';
  const merged = [...new Set([...extraPaths, ...currentPath.split(':').filter(Boolean)])].join(':');
  return {
    ...process.env,
    PATH: merged,
    DOTNET_ROOT: resolveDotnetRoot(merged)
  };
}

logInfo(`=== SharpForge Starting (PID: ${process.pid}, Node: ${process.version}, Platform: ${process.platform}) ===`);

// Trap global unhandled exceptions
process.on('uncaughtException', (err) => {
  logError('Uncaught Exception in Main Process', err);
});

process.on('unhandledRejection', (reason, promise) => {
  logError(`Unhandled Rejection at: ${promise}`, reason);
});

// =============================================================================
// Solution & Project Dependency Graph Parser (.sln, .slnx, .csproj, MSBuild)
// Supports .NET 10, .NET 9, .NET 8, .NET 7, .NET 6, .NET Standard & Framework
// Resolves Directory.Build.props, Directory.Packages.props, transitive ProjectReferences,
// linked <Compile Include="..." /> files, and obj/project.assets.json dependencies.
// =============================================================================
function readTextSafe(filePath) {
  try {
    return fs.readFileSync(filePath, 'utf-8').replace(/^\uFEFF/, '');
  } catch (e) {
    return '';
  }
}

function resolveMsBuildPathVars(rawPath, projectDir, solutionDir) {
  let p = (rawPath || '').trim().replace(/\\/g, '/');
  p = p.replace(/\$\(MSBuildThisFileDirectory\)/gi, projectDir + '/');
  p = p.replace(/\$\(MSBuildProjectDirectory\)/gi, projectDir);
  if (solutionDir) {
    p = p.replace(/\$\(SolutionDir\)/gi, solutionDir + '/');
  }
  return p;
}

function findNearestPropsFile(startDir, fileName) {
  let current = startDir;
  for (let i = 0; i < 8; i++) {
    const candidate = path.join(current, fileName);
    if (fs.existsSync(candidate)) {
      return candidate;
    }
    const parent = path.dirname(current);
    if (!parent || parent === current) break;
    current = parent;
  }
  return null;
}

function loadCentralPackageVersions(startDir) {
  const versions = new Map();
  const propsPath = findNearestPropsFile(startDir, 'Directory.Packages.props');
  if (!propsPath) return versions;

  const content = readTextSafe(propsPath);
  const regex = /<PackageVersion\b([^>]+)\/?>/gi;
  let match;
  while ((match = regex.exec(content)) !== null) {
    const attrs = match[1];
    const inc = attrs.match(/(?:Include|Update)="([^"]+)"/i);
    const ver = attrs.match(/Version="([^"]+)"/i);
    if (inc && ver) {
      versions.set(inc[1].toLowerCase(), ver[1]);
    }
  }
  return versions;
}

function loadBuildPropsTargetFramework(startDir) {
  const propsPath = findNearestPropsFile(startDir, 'Directory.Build.props');
  if (!propsPath) return null;

  const content = readTextSafe(propsPath);
  const tfMatch = content.match(/<TargetFramework(?:s)?>([^<]+)<\/TargetFramework(?:s)?>/i);
  if (!tfMatch) return null;
  let tf = tfMatch[1].trim();
  if (tf.includes(';')) tf = tf.split(';')[0].trim();
  if (tf.includes('$(')) return null;
  return tf;
}

function scanDirectory(dir, baseDir, depth = 0) {
  const items = [];
  if (depth > 14) return items;

  try {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    entries.sort((a, b) => {
      if (a.isDirectory() && !b.isDirectory()) return -1;
      if (!a.isDirectory() && b.isDirectory()) return 1;
      return a.name.localeCompare(b.name);
    });

    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      const relativePath = path.relative(baseDir, fullPath);

      if (['bin', 'obj', '.git', '.vs', '.idea', 'node_modules', 'TestResults', 'packages', '.artifacts'].includes(entry.name)) {
        continue;
      }

      if (entry.isDirectory()) {
        items.push({
          id: `dir-${fullPath}`,
          name: entry.name,
          path: fullPath,
          relativePath,
          extension: '',
          isDirectory: true,
          children: scanDirectory(fullPath, baseDir, depth + 1)
        });
      } else {
        const ext = path.extname(entry.name).toLowerCase();
        let content = undefined;
        const textExts = new Set([
          '.cs', '.json', '.xml', '.csproj', '.fsproj', '.vbproj', '.props', '.targets',
          '.md', '.txt', '.sln', '.slnx', '.yaml', '.yml', '.config', '.razor', '.cshtml',
          '.http', '.env', '.gitignore', '.editorconfig'
        ]);
        if (textExts.has(ext) || entry.name.startsWith('.env')) {
          try {
            const stat = fs.statSync(fullPath);
            if (stat.size <= 2 * 1024 * 1024) {
              content = readTextSafe(fullPath);
            }
          } catch (e) {
            content = '';
          }
        }
        items.push({
          id: `file-${fullPath}`,
          name: entry.name,
          path: fullPath,
          relativePath,
          extension: ext,
          isDirectory: false,
          content
        });
      }
    }
  } catch (err) {
    logWarn(`Directory scan warning for ${dir}: ${err.message}`);
  }
  return items;
}

function readProjectAssetsDependencies(projectDir) {
  const assetsPath = path.join(projectDir, 'obj', 'project.assets.json');
  const resolvedPackages = new Map();
  const resolvedProjectPaths = [];

  if (!fs.existsSync(assetsPath)) {
    return { resolvedPackages, resolvedProjectPaths };
  }

  try {
    const assets = JSON.parse(readTextSafe(assetsPath));
    const libraries = assets.libraries || {};
    for (const [key, lib] of Object.entries(libraries)) {
      if (!lib || typeof lib !== 'object') continue;
      if (lib.type === 'package') {
        const slashIdx = key.indexOf('/');
        if (slashIdx !== -1) {
          const pkgName = key.slice(0, slashIdx);
          const pkgVer = key.slice(slashIdx + 1);
          resolvedPackages.set(pkgName.toLowerCase(), { id: pkgName, version: pkgVer });
        }
      } else if (lib.type === 'project' && lib.msbuildProject) {
        const absProj = path.resolve(projectDir, String(lib.msbuildProject).replace(/\\/g, '/'));
        if (fs.existsSync(absProj)) {
          resolvedProjectPaths.push(absProj);
        }
      }
    }
  } catch (e) {
    logWarn(`Could not parse project.assets.json in ${projectDir}: ${e.message}`);
  }

  return { resolvedPackages, resolvedProjectPaths };
}

function evaluateCsproj(id, name, csprojPath, solutionDir) {
  const content = readTextSafe(csprojPath);
  if (!content) {
    logWarn(`Could not read .csproj or empty: ${csprojPath}`);
  }

  const projectDir = path.dirname(csprojPath);
  const centralPkgVersions = loadCentralPackageVersions(projectDir);

  // TargetFramework / TargetFrameworks detection (.NET 10, 9, 8, 7, 6, standard, framework)
  const tfMatch = content.match(/<TargetFramework(?:s)?>([^<]+)<\/TargetFramework(?:s)?>/i);
  let rawTfm = tfMatch ? tfMatch[1].trim() : '';
  const targetFrameworks = rawTfm.includes(';')
    ? rawTfm.split(';').map(s => s.trim()).filter(Boolean)
    : rawTfm
    ? [rawTfm]
    : [];
  let targetFramework = targetFrameworks[0] || '';
  if (!targetFramework || targetFramework.includes('$(')) {
    targetFramework = loadBuildPropsTargetFramework(projectDir) || 'net10.0';
  }

  // Detect project type (case-insensitive & supports Web, Worker, Razor, Console, Test)
  const launchSettingsExists = fs.existsSync(path.join(projectDir, 'Properties', 'launchSettings.json'));
  let projectType = 'classlib';
  if (
    /Microsoft\.NET\.Sdk\.(Web|Razor|BlazorWebAssembly)/i.test(content) ||
    content.includes('AddControllers') ||
    content.includes('AspNetCore')
  ) {
    projectType = 'webapi';
  } else if (
    /<IsTestProject>\s*true\s*<\/IsTestProject>/i.test(content) ||
    /\b(xunit|nunit|MSTest|Microsoft\.NET\.Test\.Sdk)\b/i.test(content)
  ) {
    projectType = 'test';
  } else if (
    /<OutputType>\s*(Exe|WinExe)\s*<\/OutputType>/i.test(content) ||
    /Microsoft\.NET\.Sdk\.Worker/i.test(content) ||
    launchSettingsExists
  ) {
    projectType = 'console';
  }

  // Read resolved NuGet + project dependencies from obj/project.assets.json if present
  const { resolvedPackages, resolvedProjectPaths } = readProjectAssetsDependencies(projectDir);

  // Parse direct PackageReferences (handles attributes in any order & Central Package Management)
  const packageReferences = [];
  const seenPackages = new Set();
  const pkgTagRegex = /<PackageReference\b([^>]+)(?:\/>|>([\s\S]*?)<\/PackageReference>)/gi;
  let tagMatch;
  while ((tagMatch = pkgTagRegex.exec(content)) !== null) {
    const attrs = tagMatch[1] || '';
    const inner = tagMatch[2] || '';
    const inc = attrs.match(/(?:Include|Update)="([^"]+)"/i);
    const verAttr = attrs.match(/Version="([^"]+)"/i);
    const verElem = inner.match(/<Version>([^<]+)<\/Version>/i);
    if (inc) {
      const pkgId = inc[1].trim();
      const lowerId = pkgId.toLowerCase();
      seenPackages.add(lowerId);
      const rawVer = verAttr ? verAttr[1] : verElem ? verElem[1] : centralPkgVersions.get(lowerId);
      const resolved = resolvedPackages.get(lowerId)?.version || rawVer || 'Resolved';
      packageReferences.push({
        id: pkgId,
        version: rawVer || resolved,
        resolvedVersion: resolved,
        isDirect: true
      });
    }
  }

  // Include transitive resolved packages from project.assets.json (marked isDirect: false)
  for (const [lowerId, pkgInfo] of resolvedPackages.entries()) {
    if (!seenPackages.has(lowerId)) {
      packageReferences.push({
        id: pkgInfo.id,
        version: pkgInfo.version,
        resolvedVersion: pkgInfo.version,
        isDirect: false
      });
    }
  }

  // Parse ProjectReferences (both name and absolute paths for transitive graph traversal)
  const projectReferences = [];
  const projectReferencePaths = [];
  const projRefRegex = /<ProjectReference\b[^>]*Include="([^"]+)"[^>]*\/?>/gi;
  let refMatch;
  while ((refMatch = projRefRegex.exec(content)) !== null) {
    const resolvedRel = resolveMsBuildPathVars(refMatch[1], projectDir, solutionDir);
    if (!resolvedRel.includes('$(')) {
      const absRefPath = path.resolve(projectDir, resolvedRel);
      const refName = path.basename(absRefPath, path.extname(absRefPath));
      if (!projectReferences.includes(refName)) {
        projectReferences.push(refName);
      }
      if (fs.existsSync(absRefPath) && !projectReferencePaths.includes(absRefPath)) {
        projectReferencePaths.push(absRefPath);
      }
    } else {
      const refName = path.basename(resolvedRel, path.extname(resolvedRel));
      if (refName && !projectReferences.includes(refName)) {
        projectReferences.push(refName);
      }
    }
  }

  // Merge project references discovered via obj/project.assets.json
  for (const absAssetProj of resolvedProjectPaths) {
    const refName = path.basename(absAssetProj, path.extname(absAssetProj));
    if (!projectReferences.includes(refName)) {
      projectReferences.push(refName);
    }
    if (!projectReferencePaths.includes(absAssetProj)) {
      projectReferencePaths.push(absAssetProj);
    }
  }

  // Parse launchSettings.json
  let launchSettings = undefined;
  const launchPath = path.join(projectDir, 'Properties', 'launchSettings.json');
  if (fs.existsSync(launchPath)) {
    try {
      launchSettings = JSON.parse(readTextSafe(launchPath));
    } catch (e) {}
  }

  const files = scanDirectory(projectDir, projectDir);

  // Include external linked <Compile Include="../Shared/Foo.cs" /> files outside projectDir
  const compileLinkRegex = /<Compile\b[^>]*Include="([^"]+\.cs)"[^>]*\/?>/gi;
  let linkMatch;
  const linkedFiles = [];
  while ((linkMatch = compileLinkRegex.exec(content)) !== null) {
    const rel = resolveMsBuildPathVars(linkMatch[1], projectDir, solutionDir);
    if (!rel.includes('*') && !rel.includes('$(')) {
      const absFile = path.resolve(projectDir, rel);
      if (!absFile.startsWith(projectDir + path.sep) && fs.existsSync(absFile)) {
        linkedFiles.push({
          id: `file-${absFile}`,
          name: path.basename(absFile),
          path: absFile,
          relativePath: rel,
          extension: '.cs',
          isDirectory: false,
          content: readTextSafe(absFile)
        });
      }
    }
  }
  if (linkedFiles.length > 0) {
    files.push({
      id: `dir-linked-${projectDir}`,
      name: 'Linked Files',
      path: `${projectDir}/__LinkedFiles__`,
      relativePath: 'Linked Files',
      extension: '',
      isDirectory: true,
      children: linkedFiles
    });
  }

  return {
    id,
    name,
    path: csprojPath,
    targetFramework,
    targetFrameworks,
    projectType,
    dependencies: {
      frameworks: projectType === 'webapi' ? ['Microsoft.AspNetCore.App', 'Microsoft.NETCore.App'] : ['Microsoft.NETCore.App'],
      packages: packageReferences,
      projectReferences
    },
    files,
    launchSettings,
    _projectReferencePaths: projectReferencePaths
  };
}

function findCsprojFilesRecursive(dir, depth = 0, found = []) {
  if (depth > 6) return found;
  try {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      if (['bin', 'obj', '.git', '.vs', '.idea', 'node_modules', 'packages'].includes(entry.name)) {
        continue;
      }
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        findCsprojFilesRecursive(fullPath, depth + 1, found);
      } else if (entry.name.toLowerCase().endsWith('.csproj') || entry.name.toLowerCase().endsWith('.fsproj')) {
        found.push(fullPath);
      }
    }
  } catch (e) {}
  return found;
}

async function loadDirectoryAsSolution(dirPath) {
  const entries = fs.readdirSync(dirPath, { withFileTypes: true });
  const slnCandidate = entries.find(
    (e) => e.isFile() && /\.(sln|slnx)$/i.test(e.name)
  );
  if (slnCandidate) {
    return loadSolution(path.join(dirPath, slnCandidate.name));
  }

  const discovered = findCsprojFilesRecursive(dirPath);
  const projects = [];
  for (let i = 0; i < discovered.length; i++) {
    const fullPath = discovered[i];
    const projName = path.basename(fullPath, path.extname(fullPath));
    try {
      const evaluated = evaluateCsproj(`proj-dir-${i + 1}`, projName, fullPath, dirPath);
      delete evaluated._projectReferencePaths;
      projects.push(evaluated);
    } catch (err) {
      logWarn(`Skipping project ${fullPath}: ${err.message}`);
    }
  }

  if (projects.length === 0) {
    projects.push({
      id: 'proj-root',
      name: path.basename(dirPath),
      path: dirPath,
      targetFramework: loadBuildPropsTargetFramework(dirPath) || 'net10.0',
      projectType: 'classlib',
      dependencies: {
        frameworks: ['Microsoft.NETCore.App'],
        packages: [],
        projectReferences: []
      },
      files: scanDirectory(dirPath, dirPath)
    });
  }

  const solResult = {
    name: `${path.basename(dirPath)}.sln`,
    path: dirPath,
    format: 'sln',
    projects
  };
  recordRecentSolution(solResult);
  return solResult;
}

const RECENT_SOLUTIONS_FILE = path.join(os.homedir(), '.sharpforge', 'recent-solutions.json');
const LEGACY_RECENT_SOLUTIONS_FILE = path.join(os.homedir(), '.minirider', 'recent-solutions.json');

function readRecentSolutions() {
  try {
    const fileToRead = fs.existsSync(RECENT_SOLUTIONS_FILE)
      ? RECENT_SOLUTIONS_FILE
      : fs.existsSync(LEGACY_RECENT_SOLUTIONS_FILE)
        ? LEGACY_RECENT_SOLUTIONS_FILE
        : null;
    if (!fileToRead) return [];
    const parsed = JSON.parse(readTextSafe(fileToRead));
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((item) => item && typeof item.path === 'string' && item.path.trim())
      .map((item) => ({
        name: item.name || path.basename(item.path),
        path: item.path,
        format: item.format === 'slnx' ? 'slnx' : 'sln',
        lastOpened: item.lastOpened || new Date().toISOString(),
        projectCount: typeof item.projectCount === 'number' ? item.projectCount : undefined,
        exists: fs.existsSync(item.path)
      }));
  } catch (_) {
    return [];
  }
}

function writeRecentSolutions(entries) {
  try {
    const dir = path.dirname(RECENT_SOLUTIONS_FILE);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    const sanitized = (entries || []).slice(0, 15).map((item) => ({
      name: item.name,
      path: item.path,
      format: item.format === 'slnx' ? 'slnx' : 'sln',
      lastOpened: item.lastOpened || new Date().toISOString(),
      projectCount: item.projectCount
    }));
    fs.writeFileSync(RECENT_SOLUTIONS_FILE, JSON.stringify(sanitized, null, 2), 'utf-8');
  } catch (err) {
    logWarn(`Could not save recent-solutions.json: ${err.message}`);
  }
}

function recordRecentSolution(sol) {
  if (!sol || !sol.path || !path.isAbsolute(sol.path)) return;
  const resolved = path.resolve(sol.path);
  const existing = readRecentSolutions().filter((item) => path.resolve(item.path) !== resolved);
  const entry = {
    name: sol.name || path.basename(resolved),
    path: resolved,
    format: sol.format === 'slnx' ? 'slnx' : 'sln',
    lastOpened: new Date().toISOString(),
    projectCount: Array.isArray(sol.projects) ? sol.projects.length : sol.projectCount,
    exists: fs.existsSync(resolved)
  };
  const next = [entry, ...existing].slice(0, 15);
  writeRecentSolutions(next);
  try {
    if (app && typeof app.addRecentDocument === 'function' && fs.existsSync(resolved)) {
      app.addRecentDocument(resolved);
    }
  } catch (_) {}
  if (mainWindow && !mainWindow.isDestroyed()) {
    try {
      setupMenu();
    } catch (_) {}
  }
  return next;
}

async function loadSolution(solutionFilePath) {
  logInfo(`Loading solution file & resolving dependency graph: ${solutionFilePath}`);
  if (!fs.existsSync(solutionFilePath)) {
    throw new Error(`File does not exist: ${solutionFilePath}`);
  }

  if (fs.statSync(solutionFilePath).isDirectory()) {
    return loadDirectoryAsSolution(solutionFilePath);
  }

  const ext = path.extname(solutionFilePath).toLowerCase();
  const solutionName = path.basename(solutionFilePath);
  const solutionDir = path.dirname(solutionFilePath);
  const content = readTextSafe(solutionFilePath);
  const projects = [];
  const seenPaths = new Set();
  const pendingQueue = [];

  const enqueueProject = (id, projName, fullPath) => {
    const normalized = path.resolve(fullPath);
    if (seenPaths.has(normalized)) return;
    if (!fs.existsSync(normalized)) {
      logWarn(`Referenced project file not found on disk: ${normalized}`);
      return;
    }
    seenPaths.add(normalized);
    pendingQueue.push({ id, projName, fullPath: normalized });
  };

  if (ext === '.slnx') {
    const projectRegex = /<Project\s+[^>]*Path="([^"]+)"/gi;
    let match;
    let idx = 1;
    while ((match = projectRegex.exec(content)) !== null) {
      const relPath = match[1].replace(/\\/g, '/');
      const fullPath = path.resolve(solutionDir, relPath);
      const projName = path.basename(relPath, path.extname(relPath));
      enqueueProject(`proj-${idx++}`, projName, fullPath);
    }
  } else {
    // Classic .sln format (skips Solution Folders GUID {2150E333-8FDC-42A3-9474-1A3956D46DE8})
    const projectRegex = /Project\("\{([A-F0-9-]+)\}"\)\s*=\s*"([^"]+)",\s*"([^"]+)",\s*"\{([A-F0-9-]+)\}"/gi;
    let match;
    while ((match = projectRegex.exec(content)) !== null) {
      const typeGuid = match[1].toUpperCase();
      const projName = match[2];
      const relPath = match[3].replace(/\\/g, '/');
      const guid = match[4];

      if (typeGuid === '2150E333-8FDC-42A3-9474-1A3956D46DE8') {
        continue; // Solution folder
      }

      if (/\.(csproj|fsproj|vbproj)$/i.test(relPath)) {
        const fullPath = path.resolve(solutionDir, relPath);
        enqueueProject(guid || `proj-${pendingQueue.length + 1}`, projName, fullPath);
      }
    }
  }

  // Fallback: Recursive scan if .sln had relative path mismatches or no projects matched
  if (pendingQueue.length === 0) {
    logWarn(`No projects resolved directly from ${solutionName}, running recursive .csproj discovery in ${solutionDir}...`);
    const discovered = findCsprojFilesRecursive(solutionDir);
    discovered.forEach((fullPath, idx) => {
      const projName = path.basename(fullPath, path.extname(fullPath));
      enqueueProject(`proj-auto-${idx + 1}`, projName, fullPath);
    });
  }

  // BFS transitive evaluation: follow ALL <ProjectReference> dependencies even outside the .sln
  while (pendingQueue.length > 0) {
    const next = pendingQueue.shift();
    try {
      const evaluated = evaluateCsproj(next.id, next.projName, next.fullPath, solutionDir);
      const refPaths = evaluated._projectReferencePaths || [];
      delete evaluated._projectReferencePaths;
      projects.push(evaluated);

      for (const refAbsPath of refPaths) {
        const refName = path.basename(refAbsPath, path.extname(refAbsPath));
        enqueueProject(`proj-dep-${seenPaths.size + 1}`, refName, refAbsPath);
      }
    } catch (err) {
      logError(`Error evaluating project ${next.fullPath}`, err);
    }
  }

  // Fallback if still empty: wrap solution directory files as a root project
  if (projects.length === 0) {
    logWarn(`No .csproj files found inside ${solutionDir}; mounting solution root directory.`);
    projects.push({
      id: 'proj-root',
      name: path.basename(solutionName, ext),
      path: solutionFilePath,
      targetFramework: loadBuildPropsTargetFramework(solutionDir) || 'net10.0',
      projectType: 'classlib',
      dependencies: {
        frameworks: ['Microsoft.NETCore.App'],
        packages: [],
        projectReferences: []
      },
      files: scanDirectory(solutionDir, solutionDir)
    });
  }

  const solutionObj = {
    name: solutionName,
    path: solutionFilePath,
    format: ext === '.slnx' ? 'slnx' : 'sln',
    projects
  };

  recordRecentSolution(solutionObj);
  logInfo(`Solution dependency graph built: ${solutionName} (${projects.length} project(s) including transitive references)`);
  return solutionObj;
}

// =============================================================================
// Window Management
// =============================================================================
let mainWindow = null;

function resolveIndexHtml() {
  const candidates = [
    path.join(__dirname, 'dist', 'index.html'),
    path.join(__dirname, 'index.html'),
    path.join(process.cwd(), 'dist', 'index.html'),
    path.join(app.getAppPath(), 'dist', 'index.html'),
    path.join(app.getAppPath(), 'index.html')
  ];

  for (const p of candidates) {
    if (fs.existsSync(p)) {
      logInfo(`Resolved UI entry point: ${p}`);
      return p;
    }
  }

  logError(`Could not find index.html. Checked locations:\n${candidates.join('\n')}`);
  return null;
}

function createWindow() {
  const iconPath = path.join(__dirname, 'resources', 'icon.png');
  const hasIcon = fs.existsSync(iconPath);
  const preloadPath = path.join(__dirname, 'preload.cjs');
  logInfo(`Creating desktop BrowserWindow (preload exists: ${fs.existsSync(preloadPath)} at ${preloadPath})`);

  mainWindow = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1024,
    minHeight: 700,
    title: 'SharpForge — Lightweight .NET IDE',
    titleBarStyle: 'hiddenInset',
    trafficLightPosition: { x: 16, y: 14 },
    icon: hasIcon ? iconPath : undefined,
    webPreferences: {
      preload: preloadPath,
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      webSecurity: true
    },
    backgroundColor: '#1e1f22',
    show: false
  });

  mainWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  mainWindow.webContents.on('will-navigate', event => event.preventDefault());

  // Renderer console message logger -> logs into ~/sharpforge-logs
  mainWindow.webContents.on('console-message', (event, level, message, line, sourceId) => {
    const logLine = `[Renderer] [${path.basename(sourceId || 'script')}:${line}] ${message}`;
    if (level === 3) {
      logError(logLine);
    } else if (level === 2) {
      logWarn(logLine);
    } else {
      logInfo(logLine);
    }
  });

  mainWindow.webContents.on('did-fail-load', (event, errorCode, errorDescription, validatedURL) => {
    const err = `Failed to load URL "${validatedURL}" (Code: ${errorCode}, Description: ${errorDescription})`;
    logError(err);
    mainWindow.webContents.openDevTools({ mode: 'detach' });
  });

  mainWindow.webContents.on('render-process-gone', (event, details) => {
    logError(`Renderer process crashed: ${details.reason} (exit code: ${details.exitCode})`);
  });

  const indexPath = resolveIndexHtml();
  if (indexPath) {
    mainWindow.loadFile(indexPath).catch((err) => {
      logError(`Failed to load file: ${indexPath}`, err);
    });
  } else if (!app.isPackaged) {
    logWarn('Falling back to local development server http://localhost:3000');
    mainWindow.loadURL('http://localhost:3000').catch((err) => {
      logError('Failed to load localhost:3000', err);
    });
  }

  mainWindow.once('ready-to-show', () => {
    logInfo('Window ready to show. Displaying UI.');
    mainWindow.show();
  });

  setupMenu();
}

function setupMenu() {
  const isMac = process.platform === 'darwin';
  const template = [
    ...(isMac ? [{
      label: 'SharpForge',
      submenu: [
        { role: 'about' },
        { type: 'separator' },
        {
          label: 'Preferences...',
          accelerator: 'CmdOrCtrl+,',
          click: () => mainWindow?.webContents.send('action:open-settings')
        },
        { type: 'separator' },
        { role: 'services' },
        { type: 'separator' },
        { role: 'hide' },
        { role: 'hideOthers' },
        { role: 'unhide' },
        { type: 'separator' },
        { role: 'quit' }
      ]
    }] : []),
    {
      label: 'File',
      submenu: [
        {
          label: 'Open Solution...',
          accelerator: 'CmdOrCtrl+O',
          click: async () => {
            logInfo('Triggered File > Open Solution dialog');
            const result = await dialog.showOpenDialog(mainWindow, {
              properties: ['openFile'],
              filters: [{ name: '.NET Solutions', extensions: ['sln', 'slnx'] }]
            });
            if (!result.canceled && result.filePaths.length > 0) {
              try {
                const solution = await loadSolution(result.filePaths[0]);
                mainWindow.webContents.send('solution:opened', solution);
              } catch (err) {
                logError(`Failed to parse selected solution: ${result.filePaths[0]}`, err);
                dialog.showErrorBox('Failed to Open Solution', err.message);
              }
            }
          }
        },
        {
          label: 'Open Folder...',
          accelerator: 'CmdOrCtrl+Shift+O',
          click: async () => {
            logInfo('Triggered File > Open Folder dialog');
            const result = await dialog.showOpenDialog(mainWindow, {
              properties: ['openDirectory']
            });
            if (!result.canceled && result.filePaths.length > 0) {
              try {
                const solution = await loadDirectoryAsSolution(result.filePaths[0]);
                mainWindow.webContents.send('solution:opened', solution);
              } catch (err) {
                logError(`Failed to open folder: ${result.filePaths[0]}`, err);
                dialog.showErrorBox('Failed to Open Folder', err.message);
              }
            }
          }
        },
        {
          label: 'Open Recent',
          submenu: (() => {
            const recents = readRecentSolutions();
            if (recents.length === 0) {
              return [{ label: 'No Recent Solutions', enabled: false }];
            }
            return [
              ...recents.slice(0, 10).map((item) => ({
                label: `${item.name} — ${item.path}${item.exists ? '' : ' (missing)'}`,
                enabled: Boolean(item.exists),
                click: async () => {
                  try {
                    const sol = await loadSolution(item.path);
                    mainWindow?.webContents.send('solution:opened', sol);
                  } catch (err) {
                    dialog.showErrorBox('Failed to Open Recent Solution', err.message);
                  }
                }
              })),
              { type: 'separator' },
              {
                label: 'Clear Recently Opened',
                click: () => {
                  writeRecentSolutions([]);
                  setupMenu();
                }
              }
            ];
          })()
        },
        {
          label: 'Save File',
          accelerator: 'CmdOrCtrl+S',
          click: () => mainWindow?.webContents.send('action:save')
        },
        { type: 'separator' },
        { role: 'close' }
      ]
    },
    {
      label: 'Edit',
      submenu: [
        { role: 'undo' },
        { role: 'redo' },
        { type: 'separator' },
        { role: 'cut' },
        { role: 'copy' },
        { role: 'paste' },
        { role: 'selectAll' }
      ]
    },
    {
      label: 'Build',
      submenu: [
        {
          label: 'Build Solution',
          accelerator: 'CmdOrCtrl+Shift+B',
          click: () => mainWindow?.webContents.send('action:build')
        },
        {
          label: 'Run Startup Project',
          accelerator: 'CmdOrCtrl+R',
          click: () => mainWindow?.webContents.send('action:run')
        }
      ]
    },
    {
      label: 'Debug',
      submenu: [
        {
          label: 'Start Debugging',
          accelerator: 'F5',
          click: () => mainWindow?.webContents.send('action:debug')
        },
        {
          label: 'Pause Debugging',
          accelerator: 'F6',
          click: () => mainWindow?.webContents.send('action:pause-debug')
        },
        {
          label: 'Toggle Breakpoint',
          accelerator: 'F9',
          click: () => mainWindow?.webContents.send('action:toggle-breakpoint')
        },
        {
          label: 'Step Over',
          accelerator: 'F10',
          click: () => mainWindow?.webContents.send('action:step-over')
        },
        {
          label: 'Step Into',
          accelerator: 'F11',
          click: () => mainWindow?.webContents.send('action:step-into')
        },
        {
          label: 'Step Out',
          accelerator: 'Shift+F11',
          click: () => mainWindow?.webContents.send('action:step-out')
        },
        {
          label: 'Stop Debugging',
          accelerator: 'Shift+F5',
          click: () => mainWindow?.webContents.send('action:stop')
        }
      ]
    },
    {
      label: 'Navigate',
      submenu: [
        {
          label: 'Back',
          accelerator: 'Alt+CmdOrCtrl+Left',
          click: () => mainWindow?.webContents.send('action:navigate-back')
        },
        {
          label: 'Forward',
          accelerator: 'Alt+CmdOrCtrl+Right',
          click: () => mainWindow?.webContents.send('action:navigate-forward')
        },
        { type: 'separator' },
        {
          label: 'Go to Implementation',
          accelerator: 'Alt+CmdOrCtrl+B',
          click: () => mainWindow?.webContents.send('action:go-to-implementation')
        },
        {
          label: 'Declaration or Usages',
          accelerator: 'CmdOrCtrl+B',
          click: () => mainWindow?.webContents.send('action:go-to-declaration')
        },
        {
          label: 'Quick Open File...',
          accelerator: 'CmdOrCtrl+P',
          click: () => mainWindow?.webContents.send('action:quick-open')
        }
      ]
    },
    {
      label: 'View',
      submenu: [
        { role: 'reload' },
        { role: 'forceReload' },
        {
          label: 'Toggle Developer Tools',
          accelerator: isMac ? 'Alt+Command+I' : 'Ctrl+Shift+I',
          click: () => mainWindow?.webContents.toggleDevTools()
        },
        {
          label: 'Open Logs Folder',
          click: () => shell.openPath(LOG_DIR)
        },
        { type: 'separator' },
        { role: 'togglefullscreen' }
      ]
    }
  ];

  const menu = Menu.buildFromTemplate(template);
  Menu.setApplicationMenu(menu);
}

const { spawn, execSync } = require('child_process');
const activeProcesses = new Map();
let activeDapSession = null;

function killProcessTree(proc) {
  if (!proc) return;
  try {
    if (process.platform !== 'win32' && proc.pid) {
      process.kill(-proc.pid, 'SIGTERM');
    } else {
      proc.kill('SIGTERM');
    }
  } catch (e) {
    try {
      proc.kill('SIGKILL');
    } catch (_) {}
  }
}

function findNetcoredbgPath(customPath) {
  const home = os.homedir();
  const unpackedDir = __dirname.includes('app.asar')
    ? __dirname.replace('app.asar', 'app.asar.unpacked')
    : __dirname;
  const resourcesDir = process.resourcesPath || __dirname;

  const candidates = [
    customPath,
    process.env.NETCOREDBG_PATH,
    path.join(unpackedDir, 'bin', 'netcoredbg', 'netcoredbg'),
    path.join(unpackedDir, 'bin', 'netcoredbg', 'netcoredbg', 'netcoredbg'),
    path.join(resourcesDir, 'bin', 'netcoredbg', 'netcoredbg'),
    path.join(resourcesDir, 'bin', 'netcoredbg', 'netcoredbg', 'netcoredbg'),
    path.join(home, '.sharpforge', 'netcoredbg', 'netcoredbg'),
    path.join(home, '.sharpforge', 'netcoredbg', 'netcoredbg', 'netcoredbg'),
    path.join(home, '.minirider', 'netcoredbg', 'netcoredbg'),
    path.join(home, '.minirider', 'netcoredbg', 'netcoredbg', 'netcoredbg'),
    '/opt/homebrew/bin/netcoredbg',
    '/usr/local/bin/netcoredbg',
    path.join(home, '.dotnet', 'tools', 'netcoredbg'),
    path.join(home, 'netcoredbg', 'netcoredbg'),
    path.join(home, '.local', 'bin', 'netcoredbg')
  ].filter(Boolean);

  for (const c of candidates) {
    try {
      if (fs.existsSync(c) && fs.statSync(c).isFile()) {
        return c;
      }
    } catch (_) {}
  }

  try {
    const resolved = execSync('which netcoredbg', { env: getEnhancedEnv(), encoding: 'utf8' }).trim();
    if (resolved && fs.existsSync(resolved)) {
      return resolved;
    }
  } catch (_) {}

  return null;
}

function parseJsonLenientMain(raw) {
  if (!raw || typeof raw !== 'string') return null;
  try {
    return JSON.parse(raw);
  } catch (_) {
    try {
      const stripped = raw
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/^\s*\/\/.*$/gm, '')
        .replace(/,\s*([}\]])/g, '$1');
      return JSON.parse(stripped);
    } catch (_) {
      return null;
    }
  }
}

function extractUrlsFromAppSettings(jsonObj) {
  if (!jsonObj || typeof jsonObj !== 'object') return [];
  const urls = [];
  if (typeof jsonObj.Urls === 'string' && jsonObj.Urls.trim()) urls.push(jsonObj.Urls.trim());
  if (typeof jsonObj.urls === 'string' && jsonObj.urls.trim()) urls.push(jsonObj.urls.trim());
  if (typeof jsonObj.ASPNETCORE_URLS === 'string' && jsonObj.ASPNETCORE_URLS.trim()) urls.push(jsonObj.ASPNETCORE_URLS.trim());
  const kestrelEndpoints = jsonObj.Kestrel?.Endpoints || jsonObj.kestrel?.endpoints;
  if (kestrelEndpoints && typeof kestrelEndpoints === 'object') {
    for (const ep of Object.values(kestrelEndpoints)) {
      const epUrl = ep?.Url || ep?.url;
      if (typeof epUrl === 'string' && epUrl.trim()) {
        urls.push(epUrl.trim());
      }
    }
  }
  const directPort = jsonObj.Port || jsonObj.port || jsonObj.Server?.Port || jsonObj.HttpPort;
  if (directPort && /^\d+$/.test(String(directPort).trim())) {
    urls.push(`http://localhost:${String(directPort).trim()}`);
  }
  return urls;
}

function resolveProjectLaunchConfig(csprojPath, buildConfig = 'Debug', targetFramework = 'net10.0', overrides = {}) {
  const projectDir = path.dirname(csprojPath);
  const projBase = path.basename(csprojPath, path.extname(csprojPath));
  const csprojContent = readTextSafe(csprojPath);
  const asmMatch = csprojContent.match(/<AssemblyName>([^<]+)<\/AssemblyName>/i);
  let assemblyName = asmMatch ? asmMatch[1].trim() : projBase;
  assemblyName = assemblyName.replace(/\$\(MSBuildProjectName\)/gi, projBase).replace(/\$\(RootNamespace\)/gi, projBase);
  if (assemblyName.includes('$(')) {
    assemblyName = projBase;
  }

  const launchEnv = {
    ASPNETCORE_ENVIRONMENT: 'Development',
    DOTNET_ENVIRONMENT: 'Development'
  };
  let applicationUrl = '';
  let args = [];
  let hasKestrelHttpUrl = false;

  const launchPath = path.join(projectDir, 'Properties', 'launchSettings.json');
  if (fs.existsSync(launchPath)) {
    try {
      const ls = parseJsonLenientMain(readTextSafe(launchPath));
      const profiles = ls?.profiles || {};
      const projectProfile =
        Object.values(profiles).find((p) => p && p.commandName === 'Project') ||
        Object.values(profiles)[0];

      if (projectProfile) {
        if (projectProfile.applicationUrl) {
          applicationUrl = String(projectProfile.applicationUrl);
          launchEnv.ASPNETCORE_URLS = applicationUrl;
        }
        if (projectProfile.environmentVariables && typeof projectProfile.environmentVariables === 'object') {
          for (const [k, v] of Object.entries(projectProfile.environmentVariables)) {
            if (v !== undefined && v !== null) {
              launchEnv[k] = String(v);
              if (!applicationUrl && (k === 'ASPNETCORE_URLS' || k === 'DOTNET_URLS')) {
                applicationUrl = String(v);
              }
            }
          }
        }
        if (projectProfile.commandLineArgs) {
          args = String(projectProfile.commandLineArgs).match(/(?:[^\s"]+|"[^"]*")+/g)?.map((s) => s.replace(/^"|"$/g, '')) || [];
        }
      }
    } catch (e) {
      logWarn(`Failed to parse launchSettings.json at ${launchPath}: ${e.message}`);
    }
  }

  // Fallback or inspection of appsettings.Development.json & appsettings.json
  for (const cfgName of ['appsettings.Development.json', 'appsettings.json']) {
    const cfgPath = path.join(projectDir, cfgName);
    if (fs.existsSync(cfgPath)) {
      const parsedCfg = parseJsonLenientMain(readTextSafe(cfgPath));
      if (parsedCfg) {
        if (parsedCfg.Kestrel?.Endpoints?.Http?.Url || parsedCfg.kestrel?.endpoints?.http?.url) {
          hasKestrelHttpUrl = true;
        }
        if (!applicationUrl) {
          const foundUrls = extractUrlsFromAppSettings(parsedCfg);
          if (foundUrls.length > 0) {
            applicationUrl = foundUrls.join(';');
          }
        }
      }
    }
  }

  // Apply explicit user customUrl / customPort override from IDE
  if (overrides && (overrides.customUrl || overrides.customPort)) {
    const finalUrl = overrides.customUrl
      ? String(overrides.customUrl).trim()
      : `http://localhost:${overrides.customPort}`;
    applicationUrl = finalUrl;
    launchEnv.ASPNETCORE_URLS = finalUrl;
    launchEnv.DOTNET_URLS = finalUrl;
    if (overrides.customPort) {
      launchEnv.PORT = String(overrides.customPort);
    }
    if (hasKestrelHttpUrl) {
      launchEnv.Kestrel__Endpoints__Http__Url = finalUrl;
    }
  }

  const defaultDll = path.join(projectDir, 'bin', buildConfig, targetFramework, `${assemblyName}.dll`);
  return {
    projectDir,
    assemblyName,
    defaultDll,
    launchEnv,
    applicationUrl,
    args
  };
}

function findBuiltDllPath(buildStdout, csprojPath, buildConfig, targetFramework) {
  const { projectDir, assemblyName, defaultDll } = resolveProjectLaunchConfig(csprojPath, buildConfig, targetFramework);
  const lines = (buildStdout || '').split('\n');
  const projBase = path.basename(csprojPath, path.extname(csprojPath));

  let fallbackBuildDll = null;
  for (const line of lines) {
    const arrowMatch = line.match(/^\s*([^\s].*?)\s*->\s*(.+\.dll)\s*$/i);
    if (arrowMatch) {
      const targetName = arrowMatch[1].trim();
      const dllPath = arrowMatch[2].trim();
      if (fs.existsSync(dllPath)) {
        if (
          targetName.toLowerCase() === projBase.toLowerCase() ||
          targetName.toLowerCase() === assemblyName.toLowerCase()
        ) {
          return dllPath;
        }
        if (dllPath.startsWith(projectDir)) {
          fallbackBuildDll = dllPath;
        }
      }
    }
  }

  if (fallbackBuildDll && fs.existsSync(fallbackBuildDll)) {
    return fallbackBuildDll;
  }

  if (fs.existsSync(defaultDll)) {
    return defaultDll;
  }

  const directConfigDll = path.join(projectDir, 'bin', buildConfig, `${assemblyName}.dll`);
  if (fs.existsSync(directConfigDll)) {
    return directConfigDll;
  }

  // Fallback: scan bin/<config> for <assemblyName>.dll or <projBase>.dll
  const binConfigDir = path.join(projectDir, 'bin', buildConfig);
  if (fs.existsSync(binConfigDir)) {
    try {
      const subdirs = fs.readdirSync(binConfigDir, { withFileTypes: true });
      for (const d of subdirs) {
        if (d.isDirectory()) {
          const candidate = path.join(binConfigDir, d.name, `${assemblyName}.dll`);
          if (fs.existsSync(candidate)) return candidate;
          const baseCandidate = path.join(binConfigDir, d.name, `${projBase}.dll`);
          if (fs.existsSync(baseCandidate)) return baseCandidate;
        }
      }
    } catch (_) {}
  }

  return defaultDll;
}

class DapDebugSession {
  constructor(netcoredbgPath, cwd, env) {
    this.netcoredbgPath = netcoredbgPath;
    this.cwd = cwd;
    this.env = env;
    this.seq = 1;
    this.pending = new Map();
    this.buffer = Buffer.alloc(0);
    this.proc = null;
    this.currentThreadId = 1;
    this.breakpointsByFile = new Map();
    this.disposed = false;
    this.lastStepCommand = null;
    this.prevTopFrame = null;
  }

  sendToUi(channel, payload) {
    try {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send(channel, payload);
      }
    } catch (_) {}
  }

  start() {
    this.proc = spawn(this.netcoredbgPath, ['--interpreter=vscode'], {
      cwd: this.cwd,
      env: this.env,
      stdio: ['pipe', 'pipe', 'pipe']
    });

    this.proc.stdout.on('data', (chunk) => {
      this.buffer = Buffer.concat([this.buffer, chunk]);
      this.drainBuffer();
    });

    this.proc.stderr.on('data', (chunk) => {
      const text = chunk.toString('utf8');
      if (text.trim()) {
        this.sendToUi('debug:event', { event: 'output', category: 'stderr', output: text });
      }
    });

    this.proc.on('close', (code) => {
      this.disposed = true;
      for (const [, entry] of this.pending.entries()) {
        entry.reject(new Error('Debugger exited'));
      }
      this.pending.clear();
      this.sendToUi('debug:event', { event: 'terminated', code });
      if (activeDapSession === this) {
        activeDapSession = null;
      }
      logInfo(`netcoredbg session closed with code ${code}`);
    });

    this.proc.on('error', (err) => {
      this.sendToUi('debug:event', {
        event: 'output',
        category: 'stderr',
        output: `Debugger error: ${err.message}\n`
      });
    });
  }

  drainBuffer() {
    while (true) {
      const headerEnd = this.buffer.indexOf('\r\n\r\n');
      if (headerEnd === -1) break;
      const headerText = this.buffer.slice(0, headerEnd).toString('ascii');
      const lenMatch = headerText.match(/Content-Length:\s*(\d+)/i);
      if (!lenMatch) {
        this.buffer = this.buffer.slice(headerEnd + 4);
        continue;
      }
      const bodyLen = parseInt(lenMatch[1], 10);
      const totalLen = headerEnd + 4 + bodyLen;
      if (this.buffer.length < totalLen) break;

      const bodyStr = this.buffer.slice(headerEnd + 4, totalLen).toString('utf8');
      this.buffer = this.buffer.slice(totalLen);

      try {
        const msg = JSON.parse(bodyStr);
        this.handleMessage(msg);
      } catch (err) {
        logWarn(`Failed to parse DAP frame: ${err.message}`);
      }
    }
  }

  request(command, args = {}) {
    if (!this.proc || this.disposed) {
      return Promise.reject(new Error('Debug session is not active'));
    }
    const seq = this.seq++;
    const payload = {
      seq,
      type: 'request',
      command,
      arguments: args
    };
    const json = JSON.stringify(payload);
    const frame = `Content-Length: ${Buffer.byteLength(json, 'utf8')}\r\n\r\n${json}`;

    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { this.pending.delete(seq); reject(new Error(`Debugger request timed out: ${command}`)); }, 15000);
      this.pending.set(seq, { resolve: value => { clearTimeout(timer); resolve(value); }, reject: error => { clearTimeout(timer); reject(error); }, command });
      try {
        this.proc.stdin.write(frame, 'utf8');
      } catch (err) {
        this.pending.delete(seq);
        reject(err);
      }
    });
  }

  async handleMessage(msg) {
    if (msg.type === 'response') {
      const pending = this.pending.get(msg.request_seq);
      if (pending) {
        this.pending.delete(msg.request_seq);
        if (msg.success) {
          pending.resolve(msg.body || {});
        } else {
          pending.reject(new Error(msg.message || `DAP command ${pending.command} failed`));
        }
      }
      return;
    }

    if (msg.type === 'event') {
      if (msg.event === 'initialized') {
        await this.configureBreakpointsAndRun();
      } else if (msg.event === 'output') {
        this.sendToUi('debug:event', {
          event: 'output',
          category: msg.body?.category || 'stdout',
          output: msg.body?.output || ''
        });
      } else if (msg.event === 'stopped') {
        await this.handleStopped(msg.body || {});
      } else if (msg.event === 'continued') {
        this.sendToUi('debug:event', {
          event: 'continued',
          threadId: msg.body?.threadId || this.currentThreadId
        });
      } else if (msg.event === 'terminated' || msg.event === 'exited') {
        this.sendToUi('debug:event', { event: msg.event, body: msg.body || {} });
      }
    }
  }

  async configureBreakpointsAndRun() {
    try {
      for (const [filePath, lines] of this.breakpointsByFile.entries()) {
        await this.setFileBreakpoints(filePath, lines);
      }
      try {
        await this.request('setExceptionBreakpoints', { filters: [] });
      } catch (_) {}
      await this.request('configurationDone', {});
    } catch (err) {
      logError('Error during DAP configurationDone', err);
    }
  }

  async setFileBreakpoints(filePath, lines) {
    this.breakpointsByFile.set(filePath, lines);
    if (!this.proc || this.disposed) return [];
    try {
      const res = await this.request('setBreakpoints', {
        source: { path: filePath },
        breakpoints: (lines || []).map((line) => ({ line })),
        sourceModified: false
      });
      return res.breakpoints || [];
    } catch (err) {
      logWarn(`setBreakpoints warning for ${filePath}: ${err.message}`);
      return [];
    }
  }

  async handleStopped(body) {
    const threadId = body.threadId || this.currentThreadId || 1;
    this.currentThreadId = threadId;
    if (body.reason === 'exception') {
      try {
        const info = await this.request('exceptionInfo', { threadId });
        const type = info.details?.fullTypeName || info.exceptionId || 'System.Exception';
        const message = info.details?.message || info.description || 'Debugger paused on exception';
        this.sendToUi('debug:event', { event: 'output', category: 'stderr', output: `${type}: ${message}\n${info.details?.stackTrace || ''}\n` });
      } catch (_) {
        this.sendToUi('debug:event', { event: 'output', category: 'stderr', output: `System.Exception: ${body.text || body.description || 'Debugger paused on exception; adapter did not provide details'}\n` });
      }
    }

    let stackFrames = [];
    let variables = [];
    let capturedReturnValue = null;

    const isExtFrame = (f) => {
      const fileLower = (f.file || '').toLowerCase();
      if (!f.file || fileLower === 'external code' || fileLower.endsWith('.dll')) return true;
      return /^(?:\[External Code\]|System\.|Microsoft\.(?!.*Controller)|Internal\.|Interop\.)/.test(f.name || '');
    };

    try {
      const st = await this.request('stackTrace', {
        threadId,
        startFrame: 0,
        levels: 40
      });
      stackFrames = (st.stackFrames || []).map((f) => {
        const frameObj = {
          id: f.id,
          name: f.name,
          file: f.source?.path || f.source?.name || 'External Code',
          line: f.line || 1,
          column: f.column || 1
        };
        return {
          ...frameObj,
          isExternal: isExtFrame(frameObj)
        };
      });

      if (stackFrames.length > 0) {
        variables = await this.fetchFrameVariables(stackFrames[0].id);

        // Check for DAP return pseudo-variable (`$ReturnValue` or return scope item)
        const retItem = variables.find(
          (v) =>
            v.name === '$ReturnValue' ||
            v.name.toLowerCase() === '$returnvalue' ||
            v.name.toLowerCase().startsWith('return value') ||
            (v.scope && v.scope.toLowerCase().includes('return'))
        );
        if (retItem) {
          capturedReturnValue = {
            functionName: this.prevTopFrame?.name || stackFrames[0].name,
            returnType: retItem.type || 'object',
            value: retItem.value,
            file: this.prevTopFrame?.file || stackFrames[0].file,
            line: this.prevTopFrame?.line || stackFrames[0].line
          };
          stackFrames[0].returnValue = {
            value: retItem.value,
            type: retItem.type || 'object',
            expression: retItem.name
          };
        } else if (this.lastStepCommand === 'stepOut' || this.lastStepCommand === 'next') {
          try {
            const evalRet = await this.evaluate('$ReturnValue', stackFrames[0].id, 'watch');
            if (evalRet && evalRet.success && evalRet.result && !evalRet.result.toLowerCase().includes('does not exist')) {
              capturedReturnValue = {
                functionName: this.prevTopFrame?.name || stackFrames[0].name,
                returnType: evalRet.type || 'object',
                value: evalRet.result,
                file: this.prevTopFrame?.file || stackFrames[0].file,
                line: this.prevTopFrame?.line || stackFrames[0].line
              };
              stackFrames[0].returnValue = {
                value: evalRet.result,
                type: evalRet.type || 'object',
                expression: '$ReturnValue'
              };
            }
          } catch (_) {}
        }

        // Capture lightweight variable/parameter snapshots for top user frames (for Call Flow Graph)
        const splitFrameVars = (vList) => ({
          parameters: vList
            .filter((v) => v.scope && /arg|param/i.test(v.scope))
            .slice(0, 6),
          localsSnapshot: vList
            .filter((v) => v.name !== 'this' && !v.name.startsWith('$') && (!v.scope || !/arg|param/i.test(v.scope)))
            .slice(0, 6)
        });

        Object.assign(stackFrames[0], splitFrameVars(variables));

        let extraCaptured = 0;
        for (let i = 1; i < stackFrames.length && extraCaptured < 5; i++) {
          if (stackFrames[i].isExternal) continue;
          extraCaptured++;
          try {
            const fVars = await this.fetchFrameVariables(stackFrames[i].id);
            Object.assign(stackFrames[i], splitFrameVars(fVars));
          } catch (_) {}
        }

        this.prevTopFrame = {
          name: stackFrames[0].name,
          file: stackFrames[0].file,
          line: stackFrames[0].line
        };
      }
    } catch (err) {
      logWarn(`Failed collecting stack/variables on stop: ${err.message}`);
    }

    const stepReason = this.lastStepCommand;
    this.lastStepCommand = null;

    this.sendToUi('debug:event', {
      event: 'stopped',
      reason: body.reason || stepReason || 'breakpoint',
      description: body.description || '',
      text: body.text || '',
      threadId,
      stackFrames,
      variables,
      returnValue: capturedReturnValue
    });
  }

  async fetchFrameVariables(frameId) {
    try {
      const scopesRes = await this.request('scopes', { frameId });
      const scopes = scopesRes.scopes || [];
      const combined = [];
      for (const scope of scopes) {
        if (scope && scope.variablesReference) {
          const vars = await this.fetchVariables(scope.variablesReference, scope.name || 'Locals');
          for (const v of vars) {
            combined.push(v);
          }
        }
      }
      return combined;
    } catch (err) {
      return [];
    }
  }

  async fetchVariables(variablesReference, scopeName) {
    if (!variablesReference) return [];
    try {
      const res = await this.request('variables', { variablesReference });
      return (res.variables || []).map((v) => ({
        name: v.name,
        value: v.value ?? '',
        type: v.type || 'object',
        scope: scopeName || undefined,
        variablesReference: v.variablesReference || 0,
        parentVariablesReference: variablesReference
      }));
    } catch (err) {
      return [];
    }
  }

  async evaluate(expression, frameId, context = 'watch') {
    try {
      const res = await this.request('evaluate', {
        expression,
        frameId,
        context: context || 'watch'
      });
      return {
        success: true,
        result: res.result ?? '',
        type: res.type || '',
        variablesReference: res.variablesReference || 0
      };
    } catch (err) {
      return { success: false, result: err.message };
    }
  }

  async setVariableValue({ variablesReference, name, expression, value, frameId }) {
    if (variablesReference && name) {
      try {
        const res = await this.request('setVariable', {
          variablesReference,
          name,
          value
        });
        return {
          success: true,
          value: res.value ?? value,
          type: res.type || '',
          variablesReference: res.variablesReference || 0
        };
      } catch (setVarErr) {
        logWarn(`DAP setVariable fallback for ${name}: ${setVarErr.message}`);
      }
    }

    const assignTarget = expression || name;
    if (assignTarget) {
      try {
        const res = await this.request('evaluate', {
          expression: `${assignTarget} = ${value}`,
          frameId,
          context: 'repl'
        });
        return {
          success: true,
          value: res.result ?? value,
          type: res.type || '',
          variablesReference: res.variablesReference || 0
        };
      } catch (evalErr) {
        return { success: false, error: evalErr.message };
      }
    }

    return { success: false, error: 'Missing variable reference or expression target.' };
  }

  async stop() {
    if (this.disposed) return;
    this.disposed = true;
    try {
      await Promise.race([
        this.request('disconnect', { terminateDebuggee: true }),
        new Promise((r) => setTimeout(r, 500))
      ]);
    } catch (_) {}
    killProcessTree(this.proc);
    this.proc = null;
  }
}

function registerIpcHandlers() {
  ipcMain.handle('dialog:open-solution', async () => {
    logInfo('IPC dialog:open-solution invoked');
    const result = await dialog.showOpenDialog(mainWindow, {
      properties: ['openFile'],
      filters: [{ name: '.NET Solutions', extensions: ['sln', 'slnx'] }]
    });
    if (!result.canceled && result.filePaths.length > 0) {
      try {
        const solution = await loadSolution(result.filePaths[0]);
        mainWindow.webContents.send('solution:opened', solution);
        return solution;
      } catch (err) {
        logError(`Failed to load solution: ${result.filePaths[0]}`, err);
        dialog.showErrorBox('Failed to Open Solution', err.message);
        throw err;
      }
    }
    return null;
  });

  ipcMain.handle('dialog:open-folder', async () => {
    logInfo('IPC dialog:open-folder invoked');
    const result = await dialog.showOpenDialog(mainWindow, {
      properties: ['openDirectory']
    });
    if (!result.canceled && result.filePaths.length > 0) {
      const solution = await loadDirectoryAsSolution(result.filePaths[0]);
      mainWindow.webContents.send('solution:opened', solution);
      return solution;
    }
    return null;
  });

  ipcMain.handle('solution:load-from-path', async (_, filePath) => {
    return loadSolution(filePath);
  });

  ipcMain.handle('recent:list', async () => {
    return readRecentSolutions();
  });

  ipcMain.handle('recent:add', async (_, entry) => {
    return recordRecentSolution(entry) || readRecentSolutions();
  });

  ipcMain.handle('recent:remove', async (_, solutionPath) => {
    const resolved = path.resolve(String(solutionPath || ''));
    const next = readRecentSolutions().filter((item) => path.resolve(item.path) !== resolved);
    writeRecentSolutions(next);
    if (mainWindow && !mainWindow.isDestroyed()) {
      try { setupMenu(); } catch (_) {}
    }
    return readRecentSolutions();
  });

  ipcMain.handle('recent:clear', async () => {
    writeRecentSolutions([]);
    if (mainWindow && !mainWindow.isDestroyed()) {
      try { setupMenu(); } catch (_) {}
    }
    return [];
  });

  ipcMain.handle('fs:read-file', async (_, filePath) => {
    try {
      if (!filePath || !path.isAbsolute(filePath) || !fs.existsSync(filePath)) {
        return { success: false, error: 'File does not exist on disk' };
      }
      const content = readTextSafe(filePath);
      return { success: true, content };
    } catch (err) {
      return { success: false, error: err.message };
    }
  });

  ipcMain.handle('dotnet:restore-solution', async (_, slnPath) => {
    const env = getEnhancedEnv();
    const cwd = path.dirname(slnPath);
    logInfo(`Running dotnet restore for ${slnPath}`);
    return new Promise((resolve) => {
      execFile('dotnet', ['restore', slnPath], { cwd, env, maxBuffer: 1024 * 1024 * 10 }, async (err, stdout, stderr) => {
        try {
          const solution = await loadSolution(slnPath);
          resolve({
            success: !err,
            stdout: stdout || '',
            stderr: stderr || '',
            code: err ? err.code : 0,
            solution
          });
        } catch (loadErr) {
          resolve({
            success: false,
            stdout: stdout || '',
            stderr: (stderr || '') + '\n' + loadErr.message,
            code: 1
          });
        }
      });
    });
  });

  ipcMain.handle('fs:save-file', async (_, filePath, content) => {
    try {
      if (!filePath || !path.isAbsolute(filePath)) {
        return { success: false, error: 'Non-disk virtual file' };
      }
      const temporary = `${filePath}.sharpforge-${process.pid}.tmp`;
      try {
        fs.writeFileSync(temporary, content, { encoding: 'utf-8', mode: fs.statSync(filePath).mode });
        fs.renameSync(temporary, filePath);
      } finally { if (fs.existsSync(temporary)) fs.unlinkSync(temporary); }
      logInfo(`Saved file to disk: ${filePath}`);
      return { success: true };
    } catch (err) {
      logError(`Failed to save file: ${filePath}`, err);
      return { success: false, error: err.message };
    }
  });

  ipcMain.handle('fs:create-file', async (_, filePath, content) => {
    try {
      if (!filePath || !path.isAbsolute(filePath)) {
        return { success: false, error: 'Path must be absolute' };
      }
      const dir = path.dirname(filePath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      fs.writeFileSync(filePath, content || '', 'utf-8');
      logInfo(`Created file on disk: ${filePath}`);
      return { success: true, filePath };
    } catch (err) {
      logError(`Failed to create file: ${filePath}`, err);
      return { success: false, error: err.message };
    }
  });

  ipcMain.handle('fs:delete-file', async (_, filePath) => {
    try {
      if (!filePath || !path.isAbsolute(filePath) || !fs.existsSync(filePath)) {
        return { success: false, error: 'File does not exist on disk' };
      }
      try {
        await shell.trashItem(filePath);
      } catch (_) {
        fs.unlinkSync(filePath);
      }
      logInfo(`Deleted/trashed file: ${filePath}`);
      return { success: true };
    } catch (err) {
      logError(`Failed to delete file: ${filePath}`, err);
      return { success: false, error: err.message };
    }
  });

  ipcMain.handle('fs:rename-file', async (_, oldPath, newPath) => {
    try {
      if (!oldPath || !newPath || !fs.existsSync(oldPath)) {
        return { success: false, error: 'Source file does not exist' };
      }
      fs.renameSync(oldPath, newPath);
      logInfo(`Renamed file: ${oldPath} -> ${newPath}`);
      return { success: true, newPath };
    } catch (err) {
      logError(`Failed to rename file: ${oldPath}`, err);
      return { success: false, error: err.message };
    }
  });

  ipcMain.handle('dotnet:detect-sdks', async () => {
    const env = getEnhancedEnv();
    return new Promise((resolve) => {
      exec('dotnet --list-sdks', { env }, (err, stdout) => {
        if (err || !stdout) {
          logWarn(`dotnet --list-sdks failed or empty: ${err ? err.message : 'no stdout'}`);
          resolve({
            current: '10.0.302',
            sdks: ['10.0.302', '9.0.100', '8.0.417', '7.0.410', '6.0.428']
          });
          return;
        }
        const lines = stdout.trim().split('\n').filter(Boolean);
        const sdks = lines.map(line => line.split(' ')[0].trim());
        logInfo(`Detected .NET SDKs: ${sdks.join(', ')}`);
        resolve({
          current: sdks[sdks.length - 1] || '10.0.302',
          sdks: sdks.length > 0 ? sdks : ['10.0.302', '8.0.417', '7.0.410', '6.0.428']
        });
      });
    });
  });

  ipcMain.handle('shell:reveal-in-finder', async (_, filePath) => {
    if (filePath && fs.existsSync(filePath)) {
      logInfo(`Revealing in Finder: ${filePath}`);
      shell.showItemInFolder(filePath);
    }
  });

  ipcMain.handle('shell:open-external', async (_, url) => {
    try {
      if (url && /^https?:\/\//i.test(String(url))) {
        await shell.openExternal(String(url));
        return true;
      }
    } catch (e) {
      logWarn(`Failed opening URL ${url}: ${e.message}`);
    }
    return false;
  });

  // Real background MSBuild/Roslyn diagnostics check on file save
  ipcMain.handle('dotnet:check-project', async (_, targetPath) => {
    const env = getEnhancedEnv();
    if (!targetPath || !fs.existsSync(targetPath)) {
      return { success: true, stdout: '', stderr: '' };
    }
    const cwd = path.dirname(targetPath);
    return new Promise((resolve) => {
      execFile(
        'dotnet', ['build', targetPath, '--no-restore', '--nologo', '-v:minimal'],
        { cwd, env, maxBuffer: 1024 * 1024 * 8 },
        (err, stdout, stderr) => {
          resolve({
            success: !err,
            stdout: stdout || '',
            stderr: stderr || '',
            code: err ? err.code : 0
          });
        }
      );
    });
  });

  // One-click netcoredbg installer for macOS arm64 / x64
  ipcMain.handle('debug:install-netcoredbg', async () => {
    const env = getEnhancedEnv();
    const targetDir = path.join(os.homedir(), '.sharpforge', 'netcoredbg');
    try {
      fs.mkdirSync(targetDir, { recursive: true });
    } catch (_) {}

    const arch = process.arch === 'arm64' ? 'arm64' : 'amd64';
    const cmd =
      arch === 'arm64'
        ? `curl -fsSL "https://github.com/Samsung/netcoredbg/releases/download/3.2.0-1092/netcoredbg-osx-arm64.zip" -o /tmp/sharpforge-netcoredbg.zip && unzip -qo /tmp/sharpforge-netcoredbg.zip -d "${targetDir}" && rm -f /tmp/sharpforge-netcoredbg.zip && find "${targetDir}" -name "netcoredbg" -exec chmod +x {} + && xattr -dr com.apple.quarantine "${targetDir}" 2>/dev/null || true`
        : `curl -fsSL "https://github.com/Samsung/netcoredbg/releases/download/3.1.3-1062/netcoredbg-osx-amd64.tar.gz" -o /tmp/sharpforge-netcoredbg.tar.gz && tar -xzf /tmp/sharpforge-netcoredbg.tar.gz -C "${targetDir}" && rm -f /tmp/sharpforge-netcoredbg.tar.gz && find "${targetDir}" -name "netcoredbg" -exec chmod +x {} + && xattr -dr com.apple.quarantine "${targetDir}" 2>/dev/null || true`;

    logInfo(`Installing netcoredbg (${arch}) into ${targetDir}`);
    return new Promise((resolve) => {
      exec(cmd, { env, maxBuffer: 1024 * 1024 * 10 }, (err, stdout, stderr) => {
        const installedPath = findNetcoredbgPath();
        if (installedPath) {
          logInfo(`netcoredbg installed at ${installedPath}`);
          resolve({ success: true, path: installedPath, output: stdout || '' });
        } else {
          logWarn(`netcoredbg install failed: ${err?.message || stderr}`);
          resolve({ success: false, path: null, error: stderr || err?.message || 'Install failed' });
        }
      });
    });
  });

  ipcMain.handle('dotnet:run-command', async (_, command, cwd) => {
    const env = getEnhancedEnv();
    logInfo(`Executing command: "${command}" in ${cwd || process.cwd()}`);
    return new Promise((resolve) => {
      exec(command, { cwd: cwd || process.cwd(), env, maxBuffer: 1024 * 1024 * 10 }, (err, stdout, stderr) => {
        if (err) {
          logError(`Command failed: "${command}"`, err);
        } else {
          logInfo(`Command finished: "${command}"`);
        }
        resolve({
          success: !err,
          stdout: stdout || '',
          stderr: stderr || '',
          code: err ? err.code : 0
        });
      });
    });
  });

  ipcMain.handle('dotnet:run-tests', async (_, options = {}) => {
    const { spawn: spawnProc } = require('child_process');
    const targetPath = options?.targetPath;
    if (!targetPath) {
      return { success: false, stdout: '', stderr: 'Missing targetPath for dotnet test.', code: 1, trxContents: [] };
    }
    const cwd = options?.cwd || path.dirname(targetPath);
    const env = getEnhancedEnv();
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sharpforge-trx-'));
    const args = [
      'test',
      targetPath,
      '--logger',
      'trx',
      '--results-directory',
      tmpDir,
      '--verbosity',
      'normal'
    ];
    if (options?.configuration) {
      args.push('-c', options.configuration);
    }
    if (options?.filter && String(options.filter).trim()) {
      args.push('--filter', String(options.filter).trim());
    }

    logInfo(`Running dotnet test: dotnet ${args.join(' ')} (cwd=${cwd})`);

    return new Promise((resolve) => {
      let stdout = '';
      let stderr = '';
      let settled = false;

      const finish = (code, errMsg) => {
        if (settled) return;
        settled = true;
        const trxContents = [];
        try {
          if (fs.existsSync(tmpDir)) {
            const files = fs.readdirSync(tmpDir).filter(f => f.toLowerCase().endsWith('.trx'));
            for (const f of files) {
              try {
                const xml = fs.readFileSync(path.join(tmpDir, f), 'utf8');
                trxContents.push({ fileName: f, xml });
              } catch {
                // Ignore unreadable trx file
              }
            }
          }
        } catch {
          // Ignore readdir errors
        } finally {
          try {
            fs.rmSync(tmpDir, { recursive: true, force: true });
          } catch {
            // Ignore cleanup errors
          }
        }
        resolve({
          success: code === 0,
          stdout,
          stderr: errMsg ? `${stderr}\n${errMsg}`.trim() : stderr,
          code: typeof code === 'number' ? code : 1,
          trxContents
        });
      };

      try {
        const child = spawnProc('dotnet', args, { cwd, env, shell: false });
        child.stdout?.on('data', (chunk) => {
          stdout += chunk.toString();
        });
        child.stderr?.on('data', (chunk) => {
          stderr += chunk.toString();
        });
        child.on('error', (err) => {
          logError('dotnet test spawn error', err);
          finish(1, err.message);
        });
        child.on('close', (code) => {
          logInfo(`dotnet test exited with code ${code}`);
          finish(typeof code === 'number' ? code : 1);
        });
      } catch (err) {
        logError('dotnet test failed to start', err);
        finish(1, err?.message || 'Failed to spawn dotnet test');
      }
    });
  });

  // Streaming long-running process (dotnet run, kestrel web host, etc.)
  ipcMain.handle('dotnet:spawn-process', async (_, command, cwd, extraEnv) => {
    const baseEnv = getEnhancedEnv();
    const env = extraEnv && typeof extraEnv === 'object' ? { ...baseEnv, ...extraEnv } : baseEnv;
    const processId = `proc-${Date.now()}`;
    logInfo(`Spawning process [${processId}]: "${command}" in ${cwd || process.cwd()}`);

    try {
      const child = spawn(command, {
        cwd: cwd || process.cwd(),
        env,
        shell: true,
        detached: process.platform !== 'win32'
      });

      activeProcesses.set(processId, child);

      child.stdout?.on('data', (chunk) => {
        mainWindow?.webContents.send('process:output', {
          processId,
          stream: 'stdout',
          text: chunk.toString()
        });
      });

      child.stderr?.on('data', (chunk) => {
        mainWindow?.webContents.send('process:output', {
          processId,
          stream: 'stderr',
          text: chunk.toString()
        });
      });

      child.on('close', (code) => {
        activeProcesses.delete(processId);
        mainWindow?.webContents.send('process:exit', { processId, code });
        logInfo(`Process [${processId}] exited with code ${code}`);
      });

      return { success: true, processId };
    } catch (err) {
      logError(`Failed to spawn process: ${command}`, err);
      return { success: false, error: err.message };
    }
  });

  ipcMain.handle('dotnet:stop-process', async (_, processId) => {
    if (processId && activeProcesses.has(processId)) {
      killProcessTree(activeProcesses.get(processId));
      activeProcesses.delete(processId);
      return true;
    }
    for (const [id, proc] of activeProcesses.entries()) {
      killProcessTree(proc);
      activeProcesses.delete(id);
    }
    return true;
  });

  // =========================================================================
  // OS Listening Ports Scanner & Service Killer (macOS/Linux/Windows)
  // =========================================================================
  function listListeningPorts() {
    const env = getEnhancedEnv();
    return new Promise((resolve) => {
      if (process.platform === 'win32') {
        exec('netstat -ano -p TCP', { env, maxBuffer: 1024 * 1024 * 4 }, (err, stdout) => {
          if (err && !stdout) {
            return resolve({ success: false, ports: [], error: err.message });
          }
          const rows = [];
          const seen = new Set();
          for (const line of String(stdout || '').split('\n')) {
            const parts = line.trim().split(/\s+/);
            if (parts.length >= 5 && parts[3] === 'LISTENING') {
              const localAddr = parts[1];
              const lastColon = localAddr.lastIndexOf(':');
              const port = parseInt(localAddr.slice(lastColon + 1), 10);
              const address = localAddr.slice(0, lastColon);
              const pid = parseInt(parts[4], 10);
              if (!Number.isNaN(port) && !Number.isNaN(pid) && pid > 0) {
                const key = `${pid}:${port}`;
                if (!seen.has(key)) {
                  seen.add(key);
                  rows.push({
                    port,
                    pid,
                    processName: `PID ${pid}`,
                    protocol: 'TCP',
                    address,
                    isDotnet: false
                  });
                }
              }
            }
          }
          rows.sort((a, b) => a.port - b.port);
          resolve({ success: true, ports: rows });
        });
        return;
      }

      // macOS / Linux via lsof
      exec('lsof -nP -iTCP -sTCP:LISTEN', { env, maxBuffer: 1024 * 1024 * 6 }, (err, stdout) => {
        if (err && !stdout) {
          return resolve({ success: false, ports: [], error: err.message });
        }
        const entries = [];
        const seen = new Set();
        const pidSet = new Set();

        const lines = String(stdout || '').split('\n').slice(1);
        for (const raw of lines) {
          const line = raw.trim();
          if (!line) continue;
          // COMMAND PID USER FD TYPE DEVICE SIZE/OFF NODE NAME
          const m = line.match(/^(\S+)\s+(\d+)\s+(\S+)\s+\S+\s+(IPv[46]|TCP)\s+\S+\s+\S+\s+TCP\s+([^\s]+)\s+\(LISTEN\)$/);
          if (!m) continue;
          const processName = m[1].replace(/\\x20/g, ' ');
          const pid = parseInt(m[2], 10);
          const user = m[3];
          const protocol = m[4];
          const endpoint = m[5];
          const colonIdx = endpoint.lastIndexOf(':');
          if (colonIdx === -1) continue;
          const port = parseInt(endpoint.slice(colonIdx + 1), 10);
          const address = endpoint.slice(0, colonIdx).replace(/^\[|\]$/g, '');
          if (Number.isNaN(port) || Number.isNaN(pid) || pid <= 0) continue;

          const dedupKey = `${pid}:${port}`;
          if (seen.has(dedupKey)) continue;
          seen.add(dedupKey);
          pidSet.add(pid);

          entries.push({
            port,
            pid,
            processName,
            protocol,
            address: address === '*' ? '0.0.0.0' : address,
            user,
            commandLine: '',
            isDotnet: /dotnet/i.test(processName)
          });
        }

        if (pidSet.size === 0) {
          return resolve({ success: true, ports: [] });
        }

        const pidList = Array.from(pidSet).join(',');
        exec(`ps -p ${pidList} -o pid=,command=`, { env, maxBuffer: 1024 * 1024 * 4 }, (_psErr, psOut) => {
          const cmdMap = new Map();
          for (const pl of String(psOut || '').split('\n')) {
            const pm = pl.trim().match(/^(\d+)\s+(.+)$/);
            if (pm) {
              cmdMap.set(parseInt(pm[1], 10), pm[2].trim());
            }
          }
          for (const item of entries) {
            const fullCmd = cmdMap.get(item.pid) || item.processName;
            item.commandLine = fullCmd;
            item.isDotnet = /dotnet|kestrel|\.dll\b/i.test(fullCmd) || /dotnet/i.test(item.processName);
          }
          entries.sort((a, b) => a.port - b.port);
          resolve({ success: true, ports: entries });
        });
      });
    });
  }

  ipcMain.handle('ports:list', async () => {
    return await listListeningPorts();
  });

  ipcMain.handle('ports:check', async (_, port) => {
    const targetPort = Number(port);
    if (!targetPort || Number.isNaN(targetPort)) {
      return { inUse: false, processes: [] };
    }
    const res = await listListeningPorts();
    const matches = (res.ports || []).filter((p) => p.port === targetPort && p.pid !== process.pid);
    return {
      inUse: matches.length > 0,
      processes: matches
    };
  });

  ipcMain.handle('ports:kill', async (_, options = {}) => {
    const { pid, port, force = false } = options;
    const targetPids = new Set();

    if (pid && Number(pid) > 0 && Number(pid) !== process.pid) {
      targetPids.add(Number(pid));
    }

    if (port && Number(port) > 0) {
      const checkRes = await listListeningPorts();
      for (const p of checkRes.ports || []) {
        if (p.port === Number(port) && p.pid !== process.pid) {
          targetPids.add(p.pid);
        }
      }
    }

    if (targetPids.size === 0) {
      return { success: false, killedPids: [], error: 'No matching active process found on that port.' };
    }

    const killedPids = [];
    const errors = [];
    const signal = force ? 'SIGKILL' : 'SIGTERM';

    for (const targetPid of targetPids) {
      try {
        process.kill(targetPid, signal);
        killedPids.push(targetPid);
        logInfo(`Sent ${signal} to PID ${targetPid} (port ${port || 'n/a'})`);
      } catch (err) {
        errors.push(`PID ${targetPid}: ${err.message}`);
      }
    }

    // If SIGTERM was used, wait briefly and verify if process exited; if still alive and force wasn't requested, retry SIGKILL for stubborn dotnet hosts
    if (!force && killedPids.length > 0) {
      await new Promise((r) => setTimeout(r, 320));
      for (const targetPid of killedPids) {
        try {
          process.kill(targetPid, 0); // still alive
          process.kill(targetPid, 'SIGKILL');
          logInfo(`Escalated to SIGKILL for PID ${targetPid}`);
        } catch (_) {
          // exited cleanly
        }
      }
    }

    return {
      success: killedPids.length > 0 && errors.length === 0,
      killedPids,
      error: errors.length > 0 ? errors.join('; ') : undefined
    };
  });

  // Check netcoredbg availability
  ipcMain.handle('debug:check-netcoredbg', async (_, customPath) => {
    const resolved = findNetcoredbgPath(customPath);
    return { available: Boolean(resolved), path: resolved };
  });

  // Real DAP Debugging via netcoredbg --interpreter=vscode
  ipcMain.handle('debug:start', async (_, options) => {
    const {
      projectPath,
      buildConfig = 'Debug',
      targetFramework = 'net10.0',
      debuggerPath,
      customPort,
      customUrl,
      breakpoints = []
    } = options || {};

    if (!projectPath || !fs.existsSync(projectPath)) {
      return { success: false, error: 'Project file does not exist on disk.' };
    }

    const netcoredbgBin = findNetcoredbgPath(debuggerPath);
    if (!netcoredbgBin) {
      return {
        success: false,
        missingDebugger: true,
        error: 'Open-source .NET debugger (netcoredbg) was not found. Install via Homebrew (`brew install samsung/netcoredbg/netcoredbg`) or configure its path in Settings.'
      };
    }

    if (activeDapSession) {
      await activeDapSession.stop();
      activeDapSession = null;
    }

    const env = getEnhancedEnv();
    const projectDir = path.dirname(projectPath);
    const csprojText = readTextSafe(projectPath);
    const hasMultiTfm = /<TargetFrameworks>[^<]*;[^<]*<\/TargetFrameworks>/i.test(csprojText);
    const tfmFlag = hasMultiTfm && targetFramework ? ` -f "${targetFramework}"` : '';

    // 1. Build target project first to produce fresh assembly + PDB symbols
    const buildResult = await new Promise((resolve) => {
      exec(
        `dotnet build "${projectPath}" -c ${buildConfig}${tfmFlag}`,
        { cwd: projectDir, env, maxBuffer: 1024 * 1024 * 10 },
        (err, stdout, stderr) => {
          resolve({
            success: !err,
            stdout: stdout || '',
            stderr: stderr || '',
            code: err ? err.code : 0
          });
        }
      );
    });

    if (!buildResult.success) {
      return {
        success: false,
        buildFailed: true,
        buildOutput: `${buildResult.stdout}\n${buildResult.stderr}`,
        error: 'Build failed before starting debugger.'
      };
    }

    const dllPath = findBuiltDllPath(buildResult.stdout, projectPath, buildConfig, targetFramework);
    if (!fs.existsSync(dllPath)) {
      return {
        success: false,
        buildOutput: buildResult.stdout,
        error: `Compiled assembly not found at ${dllPath}. Ensure this project is an executable (OutputType=Exe / Microsoft.NET.Sdk.Web), not a class library.`
      };
    }

    const launchCfg = resolveProjectLaunchConfig(projectPath, buildConfig, targetFramework, {
      customPort,
      customUrl
    });
    const mergedEnv = { ...env, ...launchCfg.launchEnv };
    const debuggeeEnv = {
      ...launchCfg.launchEnv,
      DOTNET_ROOT: mergedEnv.DOTNET_ROOT,
      PATH: mergedEnv.PATH
    };

    const session = new DapDebugSession(netcoredbgBin, launchCfg.projectDir, mergedEnv);
    activeDapSession = session;

    // Group initial breakpoints by filePath
    const grouped = new Map();
    for (const bp of breakpoints) {
      if (bp && bp.enabled && bp.filePath) {
        const list = grouped.get(bp.filePath) || [];
        list.push(bp.line);
        grouped.set(bp.filePath, list);
      }
    }
    session.breakpointsByFile = grouped;

    try {
      session.start();
      await session.request('initialize', {
        clientID: 'sharpforge',
        clientName: 'SharpForge',
        adapterID: 'coreclr',
        linesStartAt1: true,
        columnsStartAt1: true,
        pathFormat: 'path',
        supportsVariableType: true
      });

      await session.request('launch', {
        name: `${launchCfg.assemblyName} (${buildConfig})`,
        type: 'coreclr',
        request: 'launch',
        program: dllPath,
        args: launchCfg.args,
        cwd: launchCfg.projectDir,
        env: debuggeeEnv,
        stopAtEntry: false,
        justMyCode: true,
        console: 'internalConsole'
      });

      logInfo(`DAP debug session launched for ${dllPath} using ${netcoredbgBin}`);
      return {
        success: true,
        dllPath,
        netcoredbgPath: netcoredbgBin,
        applicationUrl: launchCfg.applicationUrl,
        buildOutput: buildResult.stdout
      };
    } catch (err) {
      logError('Failed to launch DAP debug session', err);
      await session.stop();
      if (activeDapSession === session) activeDapSession = null;
      return {
        success: false,
        error: err.message
      };
    }
  });

  ipcMain.handle('debug:set-breakpoints', async (_, filePath, lines) => {
    if (!activeDapSession) return [];
    return await activeDapSession.setFileBreakpoints(filePath, lines || []);
  });

  ipcMain.handle('debug:continue', async () => {
    if (!activeDapSession) return false;
    await activeDapSession.request('continue', { threadId: activeDapSession.currentThreadId });
    return true;
  });

  ipcMain.handle('debug:pause', async () => {
    if (!activeDapSession) return false;
    await activeDapSession.request('pause', { threadId: activeDapSession.currentThreadId });
    return true;
  });

  ipcMain.handle('debug:step-over', async () => {
    if (!activeDapSession) return false;
    activeDapSession.lastStepCommand = 'next';
    await activeDapSession.request('next', { threadId: activeDapSession.currentThreadId });
    return true;
  });

  ipcMain.handle('debug:step-into', async () => {
    if (!activeDapSession) return false;
    activeDapSession.lastStepCommand = 'stepIn';
    await activeDapSession.request('stepIn', { threadId: activeDapSession.currentThreadId });
    return true;
  });

  ipcMain.handle('debug:step-out', async () => {
    if (!activeDapSession) return false;
    activeDapSession.lastStepCommand = 'stepOut';
    await activeDapSession.request('stepOut', { threadId: activeDapSession.currentThreadId });
    return true;
  });

  ipcMain.handle('debug:frame-variables', async (_, frameId) => {
    if (!activeDapSession) return [];
    return await activeDapSession.fetchFrameVariables(frameId);
  });

  ipcMain.handle('debug:variables', async (_, variablesReference) => {
    if (!activeDapSession) return [];
    return await activeDapSession.fetchVariables(variablesReference);
  });

  ipcMain.handle('debug:evaluate', async (_, expression, frameId, context = 'watch') => {
    if (!activeDapSession) return { success: false, result: 'No active debug session' };
    return await activeDapSession.evaluate(expression, frameId, context);
  });

  ipcMain.handle('debug:set-variable', async (_, payload) => {
    if (!activeDapSession) return { success: false, error: 'No active debug session' };
    return await activeDapSession.setVariableValue(payload || {});
  });

  ipcMain.handle('debug:stop', async () => {
    if (activeDapSession) {
      await activeDapSession.stop();
      activeDapSession = null;
    }
    return true;
  });

  // Real Git Status / Diff / Commit
  ipcMain.handle('git:status', async (_, repoDir) => {
    const env = getEnhancedEnv();
    if (!repoDir || !fs.existsSync(repoDir)) {
      return { isRepo: false, branch: 'main', changes: [] };
    }
    return new Promise((resolve) => {
      exec('git rev-parse --show-toplevel && git branch --show-current && git status --porcelain', { cwd: repoDir, env }, (err, stdout) => {
        if (err || !stdout) {
          resolve({ isRepo: false, branch: 'main', changes: [] });
          return;
        }
        const lines = stdout.split('\n');
        const repoRoot = (lines[0] || repoDir).trim();
        const branch = (lines[1] || 'main').trim() || 'HEAD';
        const changes = lines
          .slice(2)
          .filter(l => l.trim().length >= 3)
          .map(line => {
            const status = line.slice(0, 2).trim() || 'M';
            const relFile = line.slice(3).trim().replace(/^"(.*)"$/, '$1');
            return {
              status,
              file: relFile,
              fullPath: path.resolve(repoRoot, relFile)
            };
          });
        resolve({ isRepo: true, repoRoot, branch, changes });
      });
    });
  });

  ipcMain.handle('git:diff', async (_, repoDir, filePath) => {
    const env = getEnhancedEnv();
    return new Promise((resolve) => {
      execFile('git', ['diff', '--', filePath], { cwd: repoDir, env, maxBuffer: 1024 * 1024 * 5 }, (err, stdout) => {
        resolve({ success: !err, diff: stdout || '' });
      });
    });
  });

  ipcMain.handle('git:commit', async (_, repoDir, message, files) => {
    const env = getEnhancedEnv();
    const targets = Array.isArray(files) && files.length ? ['--', ...files] : ['-A'];
    return new Promise(resolve => {
      execFile('git', ['add', ...targets], { cwd: repoDir, env }, (addError, stdout, stderr) => {
        if (addError) return resolve({ success: false, stdout, stderr });
        execFile('git', ['commit', '-m', String(message || '')], { cwd: repoDir, env }, (err, stdout, stderr) => {
          resolve({ success: !err, stdout: stdout || '', stderr: stderr || '' });
        });
      });
    });
  });

  // =========================================================================
  // Real .NET DLL Decompiler (ilspycmd + dotnet Metadata Inspector + PE Reader)
  // =========================================================================
  function findIlspycmdPath() {
    const home = os.homedir();
    const candidates = [
      path.join(home, '.dotnet', 'tools', 'ilspycmd'),
      '/opt/homebrew/bin/ilspycmd',
      '/usr/local/bin/ilspycmd',
      path.join(home, '.local', 'bin', 'ilspycmd')
    ];
    for (const c of candidates) {
      try {
        if (fs.existsSync(c) && fs.statSync(c).isFile()) return c;
      } catch (_) {}
    }
    try {
      const resolved = execSync('which ilspycmd', { env: getEnhancedEnv(), encoding: 'utf8' }).trim();
      if (resolved && fs.existsSync(resolved)) return resolved;
    } catch (_) {}
    return null;
  }

  function findDllForPackageInNugetCache(packageId, packageVersion, preferredTfm = 'net8.0') {
    const home = os.homedir();
    const nugetRoot = process.env.NUGET_PACKAGES || path.join(home, '.nuget', 'packages');
    const pkgDir = path.join(nugetRoot, String(packageId || '').toLowerCase());
    if (!fs.existsSync(pkgDir)) return null;

    let verDir = packageVersion ? path.join(pkgDir, String(packageVersion)) : null;
    if (!verDir || !fs.existsSync(verDir)) {
      try {
        const vers = fs.readdirSync(pkgDir).filter(d => !d.startsWith('.')).sort().reverse();
        if (vers.length > 0) verDir = path.join(pkgDir, vers[0]);
      } catch (_) {}
    }
    if (!verDir || !fs.existsSync(verDir)) return null;

    const libDir = path.join(verDir, 'lib');
    const refDir = path.join(verDir, 'ref');
    const scanBase = fs.existsSync(libDir) ? libDir : fs.existsSync(refDir) ? refDir : null;
    if (!scanBase) return null;

    try {
      const tfms = fs.readdirSync(scanBase);
      const prefOrder = [preferredTfm, 'net10.0', 'net9.0', 'net8.0', 'net7.0', 'net6.0', 'netstandard2.1', 'netstandard2.0'];
      tfms.sort((a, b) => {
        const ia = prefOrder.indexOf(a.toLowerCase());
        const ib = prefOrder.indexOf(b.toLowerCase());
        return (ia === -1 ? 99 : ia) - (ib === -1 ? 99 : ib);
      });
      for (const tfm of tfms) {
        const tfmPath = path.join(scanBase, tfm);
        if (!fs.statSync(tfmPath).isDirectory()) continue;
        const files = fs.readdirSync(tfmPath).filter(f => f.toLowerCase().endsWith('.dll'));
        if (files.length > 0) {
          const exact = files.find(f => f.toLowerCase() === `${packageId.toLowerCase()}.dll`);
          return path.join(tfmPath, exact || files[0]);
        }
      }
    } catch (_) {}
    return null;
  }

  function resolveProjectAssemblies(projectPath, targetFramework = 'net10.0') {
    const results = [];
    const seenDlls = new Set();
    if (!projectPath || !fs.existsSync(projectPath)) return results;
    const projectDir = fs.statSync(projectPath).isDirectory() ? projectPath : path.dirname(projectPath);

    const addDll = (name, dllPath, source, version) => {
      if (!dllPath || !fs.existsSync(dllPath) || seenDlls.has(dllPath)) return;
      seenDlls.add(dllPath);
      results.push({ name, dllPath, source, version });
    };

    // 1. Scan bin directories for compiled DLLs
    const binDir = path.join(projectDir, 'bin');
    if (fs.existsSync(binDir)) {
      const walkBin = (dir, depth = 0) => {
        if (depth > 4) return;
        try {
          for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
            const fp = path.join(dir, entry.name);
            if (entry.isDirectory()) walkBin(fp, depth + 1);
            else if (entry.name.toLowerCase().endsWith('.dll')) {
              const asmName = path.basename(entry.name, '.dll');
              const isSystem = asmName.startsWith('System.') || asmName.startsWith('Microsoft.');
              addDll(asmName, fp, isSystem ? 'framework' : 'project');
            }
          }
        } catch (_) {}
      };
      walkBin(binDir);
    }

    // 2. Resolve NuGet package DLLs from obj/project.assets.json
    const assetsPath = path.join(projectDir, 'obj', 'project.assets.json');
    if (fs.existsSync(assetsPath)) {
      try {
        const assets = JSON.parse(readTextSafe(assetsPath));
        const libraries = assets.libraries || {};
        for (const [key, lib] of Object.entries(libraries)) {
          if (lib && lib.type === 'package') {
            const [pkgId, pkgVer] = key.split('/');
            if (pkgId) {
              const dll = findDllForPackageInNugetCache(pkgId, pkgVer, targetFramework);
              if (dll) addDll(pkgId, dll, 'nuget', pkgVer);
            }
          }
        }
      } catch (_) {}
    }

    return results;
  }

  function readPeMetadataSummary(dllPath) {
    // Pure Node PE/CLR ASCII identifier & namespace summary fallback when ilspycmd / dotnet reflection fail
    try {
      const buf = fs.readFileSync(dllPath);
      const text = buf.toString('latin1');
      const matches = text.match(/[A-Z][A-Za-z0-9_]{2,}(?:\.[A-Z][A-Za-z0-9_]{2,}){1,5}/g) || [];
      const uniqueTypes = [...new Set(matches)].filter(
        (m) => !m.includes('..') && m.length < 90 && !/^(Microsoft\.Win32|System\.Runtime\.CompilerServices)/.test(m)
      ).slice(0, 120);

      const asmName = path.basename(dllPath, '.dll');
      const lines = [
        `// Decompiled metadata summary for: ${path.basename(dllPath)}`,
        `// Path: ${dllPath}`,
        `// Tip: Install ilspycmd ('Install ILSpy' button) for full C# method bodies.`,
        '',
        `namespace ${asmName}`,
        `{`,
        ...uniqueTypes.map((t) => `    public partial class ${t.split('.').pop()} { /* ${t} */ }`),
        `}`
      ];
      return { source: lines.join('\n'), types: uniqueTypes };
    } catch (err) {
      return { source: `// Unable to read metadata from ${dllPath}: ${err.message}`, types: [] };
    }
  }

  function inspectAssemblyViaDotnetHelper(dllPath, filterTypeName) {
    const helperDir = path.join(os.homedir(), '.sharpforge', 'il-inspector');
    const csprojFile = path.join(helperDir, 'IlInspector.csproj');
    const programFile = path.join(helperDir, 'Program.cs');
    const outBinary = path.join(helperDir, 'bin', 'Release', 'net8.0', 'IlInspector.dll');
    const env = getEnhancedEnv();

    try {
      if (!fs.existsSync(helperDir)) fs.mkdirSync(helperDir, { recursive: true });
      if (!fs.existsSync(csprojFile) || !fs.existsSync(programFile)) {
        // Detect highest available SDK TFMs
        let tfm = 'net8.0';
        try {
          const sdksOut = execSync('dotnet --list-sdks', { env, encoding: 'utf8' });
          const firstVer = sdksOut.trim().split('\n').pop()?.trim().split('.')[0];
          if (firstVer && Number(firstVer) >= 6) tfm = `net${firstVer}.0`;
        } catch (_) {}

        fs.writeFileSync(
          csprojFile,
          `<Project Sdk="Microsoft.NET.Sdk">
  <PropertyGroup>
    <OutputType>Exe</OutputType>
    <TargetFramework>${tfm}</TargetFramework>
    <ImplicitUsings>enable</ImplicitUsings>
    <Nullable>enable</Nullable>
    <RollForward>Major</RollForward>
  </PropertyGroup>
</Project>
`,
          'utf-8'
        );

        fs.writeFileSync(
          programFile,
          `using System;
using System.IO;
using System.Linq;
using System.Reflection;
using System.Runtime.Loader;
using System.Text;

if (args.Length == 0 || !File.Exists(args[0])) { Console.Error.WriteLine("DLL not found"); return 1; }
var dllPath = Path.GetFullPath(args[0]);
var typeFilter = args.Length > 1 ? args[1] : null;
var dir = Path.GetDirectoryName(dllPath)!;

string FormatType(Type t)
{
    if (t == typeof(void)) return "void";
    if (t == typeof(string)) return "string";
    if (t == typeof(int)) return "int";
    if (t == typeof(bool)) return "bool";
    if (t == typeof(long)) return "long";
    if (t == typeof(double)) return "double";
    if (t == typeof(decimal)) return "decimal";
    if (t == typeof(object)) return "object";
    if (t.IsGenericType)
    {
        var baseName = t.Name.Split('\`')[0];
        return $"{baseName}<{string.Join(", ", t.GetGenericArguments().Select(FormatType))}>";
    }
    if (t.IsArray) return $"{FormatType(t.GetElementType()!)}[]";
    return t.Name;
}

try
{
    var runtimeDir = Path.GetDirectoryName(typeof(object).Assembly.Location)!;
    var paths = Directory.GetFiles(runtimeDir, "*.dll")
        .Concat(Directory.GetFiles(dir, "*.dll"))
        .Distinct(StringComparer.OrdinalIgnoreCase)
        .ToArray();
    var resolver = new PathAssemblyResolver(paths);
    using var mlc = new MetadataLoadContext(resolver);
    var asm = mlc.LoadFromAssemblyPath(dllPath);
    Type[] allTypes;
    try { allTypes = asm.GetTypes(); }
    catch (ReflectionTypeLoadException rtle) { allTypes = rtle.Types.Where(t => t != null).Cast<Type>().ToArray(); }

    var sb = new StringBuilder();
    sb.AppendLine($"// Decompiled assembly metadata: {asm.GetName().Name} v{asm.GetName().Version}");
    sb.AppendLine($"// Location: {dllPath}");
    sb.AppendLine($"// Install ilspycmd in SharpForge to view full decompiled C# method bodies.");
    sb.AppendLine();

    var selected = allTypes
        .Where(t => t.IsPublic && !t.IsNested && !t.Name.StartsWith("<"))
        .Where(t => string.IsNullOrEmpty(typeFilter) ||
                    (t.FullName != null && t.FullName.Contains(typeFilter, StringComparison.OrdinalIgnoreCase)) ||
                    t.Name.Equals(typeFilter, StringComparison.OrdinalIgnoreCase))
        .OrderBy(t => t.Namespace)
        .ThenBy(t => t.Name)
        .Take(typeFilter == null ? 60 : 12)
        .ToList();

    foreach (var grp in selected.GroupBy(t => t.Namespace ?? "Global"))
    {
        sb.AppendLine($"namespace {grp.Key}");
        sb.AppendLine("{");
        foreach (var t in grp)
        {
            var kind = t.IsInterface ? "interface" : t.IsEnum ? "enum" : t.IsValueType ? "struct" : "class";
            var absMod = !t.IsInterface && t.IsAbstract && !t.IsSealed ? "abstract " : t.IsAbstract && t.IsSealed && !t.IsInterface ? "static " : "";
            var bases = new System.Collections.Generic.List<string>();
            try
            {
                if (t.BaseType != null && t.BaseType.FullName != "System.Object" && t.BaseType.FullName != "System.ValueType" && t.BaseType.FullName != "System.Enum")
                    bases.Add(FormatType(t.BaseType));
                foreach (var iface in t.GetInterfaces()) bases.Add(FormatType(iface));
            }
            catch { }
            var baseClause = bases.Count > 0 ? " : " + string.Join(", ", bases.Distinct()) : "";
            sb.AppendLine($"    public {absMod}{kind} {FormatType(t)}{baseClause}");
            sb.AppendLine("    {");

            if (t.IsEnum)
            {
                foreach (var f in t.GetFields(BindingFlags.Public | BindingFlags.Static))
                    sb.AppendLine($"        {f.Name},");
            }
            else
            {
                foreach (var p in t.GetProperties(BindingFlags.Public | BindingFlags.Instance | BindingFlags.Static | BindingFlags.DeclaredOnly))
                {
                    var stat = (p.GetMethod?.IsStatic ?? p.SetMethod?.IsStatic ?? false) ? "static " : "";
                    var acc = $"{(p.GetMethod != null ? "get; " : "")}{(p.SetMethod != null ? "set; " : "")}";
                    sb.AppendLine($"        public {stat}{FormatType(p.PropertyType)} {p.Name} {{ {acc}}}");
                }
                foreach (var c in t.GetConstructors(BindingFlags.Public | BindingFlags.Instance | BindingFlags.DeclaredOnly))
                {
                    var ps = string.Join(", ", c.GetParameters().Select(pr => $"{FormatType(pr.ParameterType)} {pr.Name}"));
                    sb.AppendLine($"        public {t.Name.Split('\`')[0]}({ps}) {{ }}");
                }
                foreach (var m in t.GetMethods(BindingFlags.Public | BindingFlags.Instance | BindingFlags.Static | BindingFlags.DeclaredOnly).Where(m => !m.IsSpecialName))
                {
                    var mod = m.IsStatic ? "static " : m.IsAbstract && !t.IsInterface ? "abstract " : m.IsVirtual && !t.IsInterface ? "virtual " : "";
                    var ps = string.Join(", ", m.GetParameters().Select(pr => $"{FormatType(pr.ParameterType)} {pr.Name}"));
                    sb.AppendLine($"        public {mod}{FormatType(m.ReturnType)} {m.Name}({ps}){(t.IsInterface || (m.IsAbstract && !t.IsInterface) ? ";" : " { /* IL body: install ilspycmd to decompile statements */ }")}");
                }
            }
            sb.AppendLine("    }");
            sb.AppendLine();
        }
        sb.AppendLine("}");
    }

    if (selected.Count == 0)
    {
        sb.AppendLine("// No matching public types found in assembly.");
    }
    Console.WriteLine(sb.ToString());
    return 0;
}
catch (Exception ex)
{
    Console.Error.WriteLine(ex.Message);
    return 2;
}
`,
          'utf-8'
        );
      }

      const cmd = fs.existsSync(outBinary)
        ? `dotnet "${outBinary}" "${dllPath}"${filterTypeName ? ` "${filterTypeName}"` : ''}`
        : `dotnet run --project "${csprojFile}" -c Release -- "${dllPath}"${filterTypeName ? ` "${filterTypeName}"` : ''}`;

      const output = execSync(cmd, { env, encoding: 'utf8', maxBuffer: 1024 * 1024 * 8, timeout: 15000 });
      return { success: true, source: output };
    } catch (err) {
      logWarn(`MetadataLoadContext fallback warning for ${dllPath}: ${err.message}`);
      return { success: false, error: err.message };
    }
  }

  ipcMain.handle('decompile:check-ilspy', async () => {
    const resolved = findIlspycmdPath();
    return { available: Boolean(resolved), path: resolved };
  });

  ipcMain.handle('decompile:install-ilspy', async () => {
    const env = getEnhancedEnv();
    logInfo('Installing ilspycmd global .NET tool...');
    return new Promise((resolve) => {
      exec('dotnet tool install -g ilspycmd || dotnet tool update -g ilspycmd', { env, maxBuffer: 1024 * 1024 * 10 }, (err, stdout, stderr) => {
        const resolved = findIlspycmdPath();
        resolve({
          success: Boolean(resolved) || !err,
          path: resolved,
          output: stdout || '',
          error: err ? (stderr || err.message) : undefined
        });
      });
    });
  });

  ipcMain.handle('decompile:pick-dll', async () => {
    const result = await dialog.showOpenDialog(mainWindow, {
      properties: ['openFile'],
      filters: [{ name: '.NET Assemblies', extensions: ['dll', 'exe'] }]
    });
    if (!result.canceled && result.filePaths.length > 0) {
      return result.filePaths[0];
    }
    return null;
  });

  ipcMain.handle('decompile:resolve-assemblies', async (_, projectPath, targetFramework = 'net10.0') => {
    return resolveProjectAssemblies(projectPath, targetFramework);
  });

  ipcMain.handle('decompile:dll', async (_, options = {}) => {
    const {
      dllPath: explicitDll,
      packageId,
      packageVersion,
      projectPath,
      targetFramework = 'net10.0',
      typeName
    } = options;

    let dllPath = explicitDll;
    if (!dllPath && packageId) {
      dllPath = findDllForPackageInNugetCache(packageId, packageVersion, targetFramework);
      if (!dllPath && projectPath) {
        const projAsms = resolveProjectAssemblies(projectPath, targetFramework);
        const matched = projAsms.find(a => a.name.toLowerCase() === packageId.toLowerCase());
        if (matched) dllPath = matched.dllPath;
      }
    }

    if (!dllPath || !fs.existsSync(dllPath)) {
      return {
        success: false,
        dllPath: dllPath || '',
        assemblyName: packageId || 'Unknown',
        source: '',
        engine: 'pe-reader',
        error: `Assembly .dll not found on disk${packageId ? ` for NuGet package '${packageId}'` : ''}. Run 'dotnet restore' or 'dotnet build' first.`
      };
    }

    const assemblyName = path.basename(dllPath, path.extname(dllPath));
    const ilspyPath = findIlspycmdPath();
    const env = getEnhancedEnv();

    if (ilspyPath) {
      try {
        // List types first if needed
        let types = [];
        try {
          const listOut = execSync(`"${ilspyPath}" -l class,interface,struct,enum "${dllPath}"`, {
            env,
            encoding: 'utf8',
            maxBuffer: 1024 * 1024 * 6,
            timeout: 12000
          });
          types = listOut.split('\n').map(l => l.trim()).filter(l => l && !l.startsWith('Type ')).slice(0, 400);
        } catch (_) {}

        let matchedType = typeName;
        if (typeName && types.length > 0) {
          const exact = types.find(t => t.endsWith(`.${typeName}`) || t === typeName);
          if (exact) matchedType = exact;
        }

        const cmd = matchedType
          ? `"${ilspyPath}" -t "${matchedType}" "${dllPath}"`
          : `"${ilspyPath}" "${dllPath}"`;

        const decompiled = execSync(cmd, {
          env,
          encoding: 'utf8',
          maxBuffer: 1024 * 1024 * 12,
          timeout: 20000
        });

        return {
          success: true,
          dllPath,
          assemblyName,
          typeName: matchedType,
          source: decompiled.slice(0, 400000),
          engine: 'ilspycmd',
          types
        };
      } catch (ilspyErr) {
        logWarn(`ilspycmd failed for ${dllPath}: ${ilspyErr.message}`);
      }
    }

    // Fallback Tier 2: dotnet MetadataLoadContext C# inspector
    const dotnetRes = inspectAssemblyViaDotnetHelper(dllPath, typeName);
    if (dotnetRes.success && dotnetRes.source) {
      return {
        success: true,
        dllPath,
        assemblyName,
        typeName,
        source: dotnetRes.source,
        engine: 'dotnet-metadata'
      };
    }

    // Fallback Tier 3: PE reader
    const peRes = readPeMetadataSummary(dllPath);
    return {
      success: true,
      dllPath,
      assemblyName,
      typeName,
      source: peRes.source,
      types: peRes.types,
      engine: 'pe-reader'
    };
  });

  ipcMain.handle('decompile:find-symbol', async (_, { symbolName, projectPath, targetFramework = 'net10.0' }) => {
    if (!symbolName || !projectPath) return null;
    const cleanSym = String(symbolName).trim();
    const assemblies = resolveProjectAssemblies(projectPath, targetFramework);
    const ilspyPath = findIlspycmdPath();
    const env = getEnhancedEnv();

    // Prioritize project & nuget assemblies before framework assemblies
    const sorted = [...assemblies].sort((a, b) => {
      const rank = { project: 0, nuget: 1, framework: 2 };
      return (rank[a.source] ?? 3) - (rank[b.source] ?? 3);
    });

    for (const asm of sorted.slice(0, 45)) {
      if (ilspyPath) {
        try {
          const listOut = execSync(`"${ilspyPath}" -l class,interface,struct,enum "${asm.dllPath}"`, {
            env,
            encoding: 'utf8',
            maxBuffer: 1024 * 1024 * 4,
            timeout: 6000
          });
          const matchLine = listOut
            .split('\n')
            .map(l => l.trim())
            .find(t => {
              const tail = t.split('.').pop() || '';
              return tail === cleanSym || tail.startsWith(`${cleanSym}\``) || t === cleanSym;
            });
          if (matchLine) {
            const decompiled = execSync(`"${ilspyPath}" -t "${matchLine}" "${asm.dllPath}"`, {
              env,
              encoding: 'utf8',
              maxBuffer: 1024 * 1024 * 6,
              timeout: 12000
            });
            return {
              success: true,
              dllPath: asm.dllPath,
              assemblyName: asm.name,
              typeName: matchLine,
              source: decompiled,
              engine: 'ilspycmd'
            };
          }
        } catch (_) {}
      } else {
        try {
          const buf = fs.readFileSync(asm.dllPath);
          if (buf.includes(cleanSym)) {
            const dotnetRes = inspectAssemblyViaDotnetHelper(asm.dllPath, cleanSym);
            if (dotnetRes.success && dotnetRes.source && dotnetRes.source.includes(cleanSym)) {
              return {
                success: true,
                dllPath: asm.dllPath,
                assemblyName: asm.name,
                typeName: cleanSym,
                source: dotnetRes.source,
                engine: 'dotnet-metadata'
              };
            }
          }
        } catch (_) {}
      }
    }

    return null;
  });

  // =========================================================================
  // VS Code (Open VSX) & JetBrains Marketplace Extensions / Plugins Engine
  // =========================================================================
  const https = require('https');
  const EXTENSIONS_ROOT = path.join(os.homedir(), '.sharpforge', 'extensions');
  const EXTENSIONS_INDEX = path.join(EXTENSIONS_ROOT, 'installed.json');
  const LEGACY_EXTENSIONS_INDEX = path.join(os.homedir(), '.minirider', 'extensions', 'installed.json');

  function readInstalledExtensions() {
    try {
      const idxPath = fs.existsSync(EXTENSIONS_INDEX)
        ? EXTENSIONS_INDEX
        : fs.existsSync(LEGACY_EXTENSIONS_INDEX)
          ? LEGACY_EXTENSIONS_INDEX
          : null;
      if (!idxPath) return [];
      const parsed = JSON.parse(readTextSafe(idxPath));
      return Array.isArray(parsed) ? parsed : [];
    } catch (_) {
      return [];
    }
  }

  function writeInstalledExtensions(list) {
    try {
      if (!fs.existsSync(EXTENSIONS_ROOT)) fs.mkdirSync(EXTENSIONS_ROOT, { recursive: true });
      fs.writeFileSync(EXTENSIONS_INDEX, JSON.stringify(list, null, 2), 'utf-8');
    } catch (err) {
      logWarn(`Could not save installed.json: ${err.message}`);
    }
  }

  function httpGetBuffer(url, redirects = 0) {
    return new Promise((resolve, reject) => {
      if (redirects > 5) return reject(new Error('Too many redirects'));
      const req = https.get(
        url,
        { headers: { 'User-Agent': 'SharpForge-IDE/1.0' }, timeout: 12000 },
        (res) => {
          if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
            return resolve(httpGetBuffer(res.headers.location, redirects + 1));
          }
          if (res.statusCode >= 400) {
            return reject(new Error(`HTTP ${res.statusCode}`));
          }
          const chunks = [];
          res.on('data', (c) => chunks.push(c));
          res.on('end', () => resolve(Buffer.concat(chunks)));
        }
      );
      req.on('error', reject);
      req.on('timeout', () => {
        req.destroy();
        reject(new Error('Request timed out'));
      });
    });
  }

  async function httpGetJson(url) {
    const buf = await httpGetBuffer(url);
    return JSON.parse(buf.toString('utf8'));
  }

  ipcMain.handle('extensions:list', async () => {
    return readInstalledExtensions();
  });

  ipcMain.handle('extensions:search', async (_, query = '', source = 'all') => {
    const cleanQ = encodeURIComponent((query || 'csharp').trim() || 'csharp');
    const installed = readInstalledExtensions();
    const installedMap = new Map(installed.map(e => [e.id, e]));
    const results = [];

    const wantsVscode = source === 'all' || source === 'vscode';
    const wantsJetbrains = source === 'all' || source === 'jetbrains';

    const tasks = [];
    if (wantsVscode) {
      tasks.push(
        httpGetJson(`https://open-vsx.org/api/-/search?query=${cleanQ}&size=18&sortBy=downloadCount`)
          .then((data) => {
            for (const ext of data.extensions || []) {
              const id = `vscode:${ext.namespace}.${ext.name}`;
              const inst = installedMap.get(id);
              results.push({
                id,
                name: ext.name,
                displayName: ext.displayName || ext.name,
                publisher: ext.namespace,
                version: ext.version || '1.0.0',
                description: ext.description || 'VS Code compatible extension from Open VSX Registry',
                source: 'vscode',
                downloadUrl: ext.files?.download,
                homepageUrl: ext.url || `https://open-vsx.org/extension/${ext.namespace}/${ext.name}`,
                downloads: ext.downloadCount,
                rating: ext.averageRating,
                categories: ext.categories || [],
                iconUrl: ext.files?.icon,
                installed: Boolean(inst),
                enabled: inst ? inst.enabled !== false : false,
                themes: inst?.themes
              });
            }
          })
          .catch((err) => logWarn(`Open VSX search failed: ${err.message}`))
      );
    }

    if (wantsJetbrains) {
      tasks.push(
        httpGetJson(`https://plugins.jetbrains.com/api/searchPlugins?search=${cleanQ}&max=16`)
          .then((data) => {
            for (const p of data.plugins || []) {
              const id = `jetbrains:${p.xmlId || p.id}`;
              const inst = installedMap.get(id);
              results.push({
                id,
                name: p.xmlId || String(p.id),
                displayName: p.name,
                publisher: p.vendor?.name || 'JetBrains Community',
                version: p.cdate ? 'Latest' : '1.0.0',
                description: (p.preview || p.description || 'JetBrains IDE Plugin').replace(/<[^>]+>/g, ''),
                source: 'jetbrains',
                downloadUrl: p.id ? `https://plugins.jetbrains.com/plugin/download?rel=true&pluginId=${p.id}` : undefined,
                homepageUrl: p.link ? `https://plugins.jetbrains.com${p.link}` : undefined,
                downloads: p.downloads,
                rating: p.rating,
                categories: p.tags || ['JetBrains'],
                iconUrl: p.icon ? `https://plugins.jetbrains.com${p.icon}` : undefined,
                installed: Boolean(inst),
                enabled: inst ? inst.enabled !== false : false
              });
            }
          })
          .catch((err) => logWarn(`JetBrains Marketplace search failed: ${err.message}`))
      );
    }

    await Promise.all(tasks);
    return results;
  });

  ipcMain.handle('extensions:install', async (_, ext) => {
    if (!ext || !ext.id || ext.source !== 'vscode') return { success: false, error: 'Only Open VSX color themes are supported' };
    const safeDirName = ext.id.replace(/[^a-zA-Z0-9._-]/g, '_');
    const extDir = path.join(EXTENSIONS_ROOT, safeDirName);
    fs.mkdirSync(extDir, { recursive: true });

    const extractedThemes = [];
    if (ext.downloadUrl) {
      try {
        const archiveBuf = await httpGetBuffer(ext.downloadUrl);
        if (ext.source === 'vscode' || ext.downloadUrl.includes('.vsix')) {
          const JSZip = require('jszip');
          const zip = await JSZip.loadAsync(archiveBuf);
          const pkgEntry = zip.file('extension/package.json');
          if (pkgEntry) {
            const pkgText = await pkgEntry.async('string');
            fs.writeFileSync(path.join(extDir, 'package.json'), pkgText, 'utf-8');
            const pkgJson = JSON.parse(pkgText);
            const contributedThemes = pkgJson.contributes?.themes || [];
            for (const t of contributedThemes) {
              if (!t.path) continue;
              const cleanRel = t.path.replace(/^\.\//, '');
              const themeEntry = zip.file(`extension/${cleanRel}`);
              if (themeEntry) {
                try {
                  const themeRaw = await themeEntry.async('string');
                  // Strip JSON comments cleanly if any
                  const cleanJson = themeRaw.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
                  const themeObj = JSON.parse(cleanJson);
                  const rules = [];
                  for (const tc of themeObj.tokenColors || []) {
                    const scopes = Array.isArray(tc.scope) ? tc.scope : tc.scope ? [tc.scope] : [];
                    const fg = tc.settings?.foreground?.replace(/^#/, '');
                    const fsMod = tc.settings?.fontStyle || '';
                    for (const sc of scopes) {
                      if (sc && (fg || fsMod)) {
                        rules.push({ token: sc.split('.')[0], foreground: fg, fontStyle: fsMod });
                      }
                    }
                  }
                  extractedThemes.push({
                    id: `ext-${safeDirName}-${extractedThemes.length}`,
                    label: t.label || ext.displayName,
                    uiTheme: t.uiTheme || 'vs-dark',
                    colors: themeObj.colors || {},
                    rules: rules.slice(0, 120)
                  });
                } catch (_) {}
              }
            }
          }
        } else {
          fs.writeFileSync(path.join(extDir, 'plugin.zip'), archiveBuf);
        }
      } catch (dlErr) {
        return { success: false, error: `Theme import failed: ${dlErr.message}` };
      }
    }

    if (!extractedThemes.length && !ext.themes?.length) return { success: false, error: 'This package does not contain a supported color theme. General extensions are not supported.' };
    const installedRecord = {
      ...ext,
      installed: true,
      enabled: true,
      installedPath: extDir,
      themes: extractedThemes.length > 0 ? extractedThemes : ext.themes
    };
    fs.writeFileSync(path.join(extDir, 'manifest.json'), JSON.stringify(installedRecord, null, 2), 'utf-8');

    const current = readInstalledExtensions().filter(e => e.id !== ext.id);
    current.push(installedRecord);
    writeInstalledExtensions(current);
    logInfo(`Installed extension ${ext.id} into ${extDir}`);
    return { success: true, extension: installedRecord };
  });

  ipcMain.handle('extensions:uninstall', async (_, id) => {
    const safeDirName = String(id || '').replace(/[^a-zA-Z0-9._-]/g, '_');
    const extDir = path.join(EXTENSIONS_ROOT, safeDirName);
    try {
      if (fs.existsSync(extDir)) fs.rmSync(extDir, { recursive: true, force: true });
    } catch (_) {}
    const next = readInstalledExtensions().filter(e => e.id !== id);
    writeInstalledExtensions(next);
    return { success: true };
  });

  ipcMain.handle('extensions:toggle', async (_, id, enabled) => {
    const next = readInstalledExtensions().map(e => (e.id === id ? { ...e, enabled: Boolean(enabled) } : e));
    writeInstalledExtensions(next);
    return { success: true, extensions: next };
  });
}

if (app) {
  app.whenReady().then(() => {
    logInfo('Electron App is ready.');
    registerIpcHandlers();
    require('./desktop/terminals.cjs').registerTerminals({ ipcMain, app, getWindow: () => mainWindow, getEnv: getEnhancedEnv });
    createWindow();

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
  });

  app.on('open-file', async (event, filePath) => {
    event.preventDefault();
    logInfo(`macOS open-file event: ${filePath}`);
    try {
      const solution = await loadSolution(filePath);
      if (mainWindow) {
        mainWindow.webContents.send('solution:opened', solution);
      }
    } catch (err) {
      logError(`Failed to open file via macOS event: ${filePath}`, err);
    }
  });

  app.on('before-quit', async () => {
    if (activeDapSession) {
      try {
        await activeDapSession.stop();
      } catch (_) {}
      activeDapSession = null;
    }
    for (const proc of activeProcesses.values()) {
      killProcessTree(proc);
    }
    activeProcesses.clear();
  });

  app.on('window-all-closed', () => {
    logInfo('All windows closed.');
    if (process.platform !== 'darwin') {
      app.quit();
    }
  });
}
