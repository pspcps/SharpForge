import { SolutionFile, ProjectItem, SolutionFileItem } from '../types/minirider';

/**
 * Parse a .sln or .slnx file selected in standard web browser mode (or when Electron IPC is unavailable)
 */
export async function parseBrowserSolutionFile(slnFile: File): Promise<SolutionFile> {
  const rawContent = (await slnFile.text()).replace(/^\uFEFF/, '');
  const ext = slnFile.name.toLowerCase().endsWith('.slnx') ? 'slnx' : 'sln';
  const projects: ProjectItem[] = [];

  if (ext === 'slnx') {
    const regex = /<Project\s+[^>]*Path="([^"]+)"/gi;
    let match: RegExpExecArray | null;
    let idx = 1;
    while ((match = regex.exec(rawContent)) !== null) {
      const relPath = match[1].replace(/\\/g, '/');
      const projName = relPath.split('/').pop()?.replace(/\.(csproj|fsproj|vbproj)$/i, '') || `Project${idx}`;
      projects.push(createPlaceholderProject(`proj-${idx++}`, projName, relPath, slnFile.name, rawContent));
    }
  } else {
    const regex = /Project\("\{([A-F0-9-]+)\}"\)\s*=\s*"([^"]+)",\s*"([^"]+)",\s*"\{([A-F0-9-]+)\}"/gi;
    let match: RegExpExecArray | null;
    while ((match = regex.exec(rawContent)) !== null) {
      const typeGuid = match[1].toUpperCase();
      if (typeGuid === '2150E333-8FDC-42A3-9474-1A3956D46DE8') continue;
      const projName = match[2];
      const relPath = match[3].replace(/\\/g, '/');
      const guid = match[4];
      if (/\.(csproj|fsproj|vbproj)$/i.test(relPath)) {
        projects.push(createPlaceholderProject(guid, projName, relPath, slnFile.name, rawContent));
      }
    }
  }

  if (projects.length === 0) {
    projects.push(createPlaceholderProject('proj-1', slnFile.name.replace(/\.(sln|slnx)$/i, ''), slnFile.name, slnFile.name, rawContent));
  }

  return {
    name: slnFile.name,
    path: slnFile.name,
    format: ext,
    projects
  };
}

/**
 * Parse an entire selected folder (via webkitdirectory) into a full SolutionFile with all C# and config files.
 */
export async function parseBrowserDirectoryFiles(fileList: FileList): Promise<SolutionFile | null> {
  const files = Array.from(fileList).filter(
    f => !/\/(bin|obj|\.git|\.vs|\.idea|node_modules)\//i.test(f.webkitRelativePath)
  );
  if (files.length === 0) return null;

  const slnFile = files.find(f => f.name.toLowerCase().endsWith('.sln') || f.name.toLowerCase().endsWith('.slnx'));
  const csprojFiles = files.filter(f => /\.(csproj|fsproj)$/i.test(f.name));
  const rootFolderName = files[0].webkitRelativePath.split('/')[0] || 'OpenedSolution';

  const projects: ProjectItem[] = [];

  for (let i = 0; i < csprojFiles.length; i++) {
    const csproj = csprojFiles[i];
    const csprojText = (await csproj.text()).replace(/^\uFEFF/, '');
    const tfMatch = csprojText.match(/<TargetFramework(?:s)?>([^<]+)<\/TargetFramework(?:s)?>/i);
    let tf = tfMatch ? tfMatch[1].trim() : 'net10.0';
    if (tf.includes(';')) tf = tf.split(';')[0].trim();

    const projDir = csproj.webkitRelativePath.split('/').slice(0, -1).join('/');
    const projName = csproj.name.replace(/\.(csproj|fsproj)$/i, '');

    let projectType: ProjectItem['projectType'] = 'classlib';
    if (csprojText.includes('Microsoft.NET.Sdk.Web') || csprojText.includes('AspNetCore')) {
      projectType = 'webapi';
    } else if (csprojText.includes('IsTestProject') || csprojText.toLowerCase().includes('xunit') || csprojText.toLowerCase().includes('nunit')) {
      projectType = 'test';
    } else if (csprojText.includes('<OutputType>Exe</OutputType>')) {
      projectType = 'console';
    }

    const packages: { id: string; version: string; resolvedVersion?: string; isDirect: boolean }[] = [];
    const pkgTagRegex = /<PackageReference\b([^>]+)\/?>/gi;
    let tagMatch: RegExpExecArray | null;
    while ((tagMatch = pkgTagRegex.exec(csprojText)) !== null) {
      const attrs = tagMatch[1];
      const inc = attrs.match(/(?:Include|Update)="([^"]+)"/i);
      const ver = attrs.match(/Version="([^"]+)"/i);
      if (inc) {
        packages.push({
          id: inc[1],
          version: ver ? ver[1] : 'Latest',
          resolvedVersion: ver ? ver[1] : 'Latest',
          isDirect: true
        });
      }
    }

    const projectReferences: string[] = [];
    const projRefRegex = /<ProjectReference\b[^>]*Include="([^"]+)"[^>]*\/?>/gi;
    let refMatch: RegExpExecArray | null;
    while ((refMatch = projRefRegex.exec(csprojText)) !== null) {
      const refPath = refMatch[1].replace(/\\/g, '/');
      const refName = refPath.split('/').pop()?.replace(/\.(csproj|fsproj|vbproj)$/i, '');
      if (refName && !projectReferences.includes(refName)) {
        projectReferences.push(refName);
      }
    }

    const projectFiles = files.filter(f =>
      projDir ? f.webkitRelativePath.startsWith(projDir + '/') : true
    );
    const tree = await buildFileTree(projectFiles, projDir ? projDir + '/' : '');

    projects.push({
      id: `browser-proj-${i + 1}`,
      name: projName,
      path: csproj.webkitRelativePath,
      targetFramework: tf,
      projectType,
      dependencies: {
        frameworks: projectType === 'webapi' ? ['Microsoft.AspNetCore.App', 'Microsoft.NETCore.App'] : ['Microsoft.NETCore.App'],
        packages,
        projectReferences
      },
      files: tree
    });
  }

  if (projects.length === 0) {
    const tree = await buildFileTree(files, rootFolderName + '/');
    projects.push({
      id: 'browser-proj-root',
      name: rootFolderName,
      path: rootFolderName,
      targetFramework: 'net10.0',
      projectType: 'classlib',
      dependencies: {
        frameworks: ['Microsoft.NETCore.App'],
        packages: [],
        projectReferences: []
      },
      files: tree
    });
  }

  return {
    name: slnFile ? slnFile.name : `${rootFolderName}.sln`,
    path: slnFile ? slnFile.webkitRelativePath : rootFolderName,
    format: slnFile?.name.toLowerCase().endsWith('.slnx') ? 'slnx' : 'sln',
    projects
  };
}

function createPlaceholderProject(
  id: string,
  name: string,
  relPath: string,
  slnName: string,
  slnContent: string
): ProjectItem {
  const slnItem: SolutionFileItem = {
    id: `file-${id}-sln`,
    name: slnName,
    path: `${name}/${slnName}`,
    relativePath: slnName,
    extension: slnName.toLowerCase().endsWith('.slnx') ? '.slnx' : '.sln',
    isDirectory: false,
    content: slnContent
  };

  return {
    id,
    name,
    path: relPath,
    targetFramework: 'net10.0',
    projectType: name.toLowerCase().includes('test') ? 'test' : name.toLowerCase().includes('api') ? 'webapi' : 'classlib',
    dependencies: {
      frameworks: ['Microsoft.NETCore.App'],
      packages: [],
      projectReferences: []
    },
    files: [slnItem]
  };
}

async function buildFileTree(files: File[], prefixToStrip: string): Promise<SolutionFileItem[]> {
  const root: SolutionFileItem[] = [];
  const dirMap = new Map<string, SolutionFileItem>();

  for (const file of files) {
    const rel = file.webkitRelativePath.startsWith(prefixToStrip)
      ? file.webkitRelativePath.slice(prefixToStrip.length)
      : file.webkitRelativePath;
    if (!rel) continue;

    const parts = rel.split('/');
    let currentChildren = root;
    let currentPath = '';

    for (let i = 0; i < parts.length - 1; i++) {
      const part = parts[i];
      currentPath = currentPath ? `${currentPath}/${part}` : part;
      let dirNode = dirMap.get(currentPath);
      if (!dirNode) {
        dirNode = {
          id: `dir-${prefixToStrip}${currentPath}`,
          name: part,
          path: `${prefixToStrip}${currentPath}`,
          relativePath: currentPath,
          extension: '',
          isDirectory: true,
          children: []
        };
        dirMap.set(currentPath, dirNode);
        currentChildren.push(dirNode);
      }
      currentChildren = dirNode.children!;
    }

    const fileName = parts[parts.length - 1];
    const dotIdx = fileName.lastIndexOf('.');
    const ext = dotIdx !== -1 ? fileName.slice(dotIdx).toLowerCase() : '';
    let content = '';
    if (['.cs', '.json', '.xml', '.csproj', '.md', '.txt', '.sln', '.slnx', '.yaml', '.yml', '.config'].includes(ext) && file.size < 512 * 1024) {
      content = await file.text();
    }

    currentChildren.push({
      id: `file-${file.webkitRelativePath}`,
      name: fileName,
      path: file.webkitRelativePath,
      relativePath: rel,
      extension: ext,
      isDirectory: false,
      content
    });
  }

  return root;
}
