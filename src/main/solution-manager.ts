import * as fs from 'fs';
import * as path from 'path';
import { SolutionFile, ProjectItem, SolutionFileItem } from '../types/minirider';

/**
 * SolutionManager parses both classic .sln files and modern .slnx (XML-based) solution files.
 * It builds a project tree, detects project types (Web API, Class Library, Test project),
 * and parses project dependencies.
 */
export class SolutionManager {
  /**
   * Parse a solution file from disk
   */
  public async loadSolution(solutionFilePath: string): Promise<SolutionFile> {
    const ext = path.extname(solutionFilePath).toLowerCase();
    const solutionName = path.basename(solutionFilePath);

    if (!fs.existsSync(solutionFilePath)) {
      throw new Error(`Solution file does not exist: ${solutionFilePath}`);
    }

    const content = fs.readFileSync(solutionFilePath, 'utf-8');

    if (ext === '.slnx') {
      return this.parseSlnx(solutionFilePath, solutionName, content);
    } else {
      return this.parseClassicSln(solutionFilePath, solutionName, content);
    }
  }

  /**
   * Parses Microsoft Visual Studio Solution File, Format Version 12.00 (.sln)
   */
  private async parseClassicSln(filePath: string, name: string, content: string): Promise<SolutionFile> {
    const solutionDir = path.dirname(filePath);
    const projects: ProjectItem[] = [];

    // Regex to match Project lines:
    // Project("{FAE04EC0-301F-11D3-BF4B-00C04F79EFBC}") = "WeatherTracker.Api", "WeatherTracker.Api\WeatherTracker.Api.csproj", "{GUID}"
    const projectRegex = /Project\("\{[A-F0-9-]+\}"\)\s*=\s*"([^"]+)",\s*"([^"]+)",\s*"\{([A-F0-9-]+)\}"/gi;
    let match: RegExpExecArray | null;

    while ((match = projectRegex.exec(content)) !== null) {
      const projectName = match[1];
      const projectRelPath = match[2].replace(/\\/g, '/');
      const projectGuid = match[3];

      if (projectRelPath.endsWith('.csproj')) {
        const fullProjectPath = path.resolve(solutionDir, projectRelPath);
        if (fs.existsSync(fullProjectPath)) {
          const project = await this.evaluateCsproj(projectGuid, projectName, fullProjectPath);
          projects.push(project);
        }
      }
    }

    return {
      name,
      path: filePath,
      format: 'sln',
      projects
    };
  }

  /**
   * Parses modern .slnx XML solution format (introduced in .NET 9)
   * Example:
   * <Solution>
   *   <Project Path="MiniStore.CatalogApi/MiniStore.CatalogApi.csproj" />
   * </Solution>
   */
  private async parseSlnx(filePath: string, name: string, content: string): Promise<SolutionFile> {
    const solutionDir = path.dirname(filePath);
    const projects: ProjectItem[] = [];

    const projectRegex = /<Project\s+Path="([^"]+)"/gi;
    let match: RegExpExecArray | null;

    let index = 1;
    while ((match = projectRegex.exec(content)) !== null) {
      const projectRelPath = match[1].replace(/\\/g, '/');
      const projectName = path.basename(projectRelPath, '.csproj');
      const fullProjectPath = path.resolve(solutionDir, projectRelPath);

      if (fs.existsSync(fullProjectPath)) {
        const project = await this.evaluateCsproj(`proj-${index++}`, projectName, fullProjectPath);
        projects.push(project);
      }
    }

    return {
      name,
      path: filePath,
      format: 'slnx',
      projects
    };
  }

  /**
   * Evaluates .csproj to discover target framework, dependencies, package references, and project type.
   */
  public async evaluateCsproj(id: string, name: string, csprojPath: string): Promise<ProjectItem> {
    const content = fs.readFileSync(csprojPath, 'utf-8');
    const projectDir = path.dirname(csprojPath);

    // Detect TargetFramework
    const tfMatch = content.match(/<TargetFramework>([^<]+)<\/TargetFramework>/i);
    const targetFramework = tfMatch ? tfMatch[1] : 'net8.0';

    // Detect SDK / Project Type
    let projectType: 'webapi' | 'classlib' | 'test' | 'console' = 'classlib';
    if (content.includes('Microsoft.NET.Sdk.Web') || content.includes('AddControllers') || content.includes('AddEndpointsApiExplorer')) {
      projectType = 'webapi';
    } else if (content.includes('IsTestProject') || content.includes('xunit') || content.includes('nunit') || content.includes('MSTest.TestAdapter')) {
      projectType = 'test';
    } else if (content.includes('<OutputType>Exe</OutputType>')) {
      projectType = 'console';
    }

    // Parse PackageReferences
    const packageReferences: { id: string; version: string; resolvedVersion?: string; isDirect: boolean }[] = [];
    const pkgRegex = /<PackageReference\s+Include="([^"]+)"(?:\s+Version="([^"]+)")?/gi;
    let pkgMatch: RegExpExecArray | null;
    while ((pkgMatch = pkgRegex.exec(content)) !== null) {
      packageReferences.push({
        id: pkgMatch[1],
        version: pkgMatch[2] || 'Latest',
        resolvedVersion: pkgMatch[2] || 'Latest',
        isDirect: true
      });
    }

    // Parse ProjectReferences
    const projectReferences: string[] = [];
    const projRefRegex = /<ProjectReference\s+Include="([^"]+)"/gi;
    let refMatch: RegExpExecArray | null;
    while ((refMatch = projRefRegex.exec(content)) !== null) {
      const refPath = refMatch[1].replace(/\\/g, '/');
      const refName = path.basename(refPath, '.csproj');
      projectReferences.push(refName);
    }

    // Parse launchSettings.json if exists
    let launchSettings;
    const launchSettingsPath = path.join(projectDir, 'Properties', 'launchSettings.json');
    if (fs.existsSync(launchSettingsPath)) {
      try {
        const jsonRaw = fs.readFileSync(launchSettingsPath, 'utf-8');
        launchSettings = JSON.parse(jsonRaw);
      } catch (err) {
        console.warn(`Failed to parse launchSettings.json: ${err}`);
      }
    }

    // Scan source files recursively
    const files = this.scanDirectory(projectDir, projectDir);

    return {
      id,
      name,
      path: csprojPath,
      targetFramework,
      projectType,
      dependencies: {
        frameworks: projectType === 'webapi' ? ['Microsoft.AspNetCore.App', 'Microsoft.NETCore.App'] : ['Microsoft.NETCore.App'],
        packages: packageReferences,
        projectReferences
      },
      files,
      launchSettings
    };
  }

  /**
   * Recursively scans directory, ignoring bin, obj, .git
   */
  private scanDirectory(dir: string, baseDir: string): SolutionFileItem[] {
    const items: SolutionFileItem[] = [];
    const entries = fs.readdirSync(dir, { withFileTypes: true });

    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      const relativePath = path.relative(baseDir, fullPath);

      // Skip build and hidden artifacts
      if (['bin', 'obj', '.git', '.vs', '.idea'].includes(entry.name)) {
        continue;
      }

      if (entry.isDirectory()) {
        items.push({
          id: `dir-${relativePath}`,
          name: entry.name,
          path: fullPath,
          relativePath,
          extension: '',
          isDirectory: true,
          children: this.scanDirectory(fullPath, baseDir)
        });
      } else {
        const ext = path.extname(entry.name).toLowerCase();
        let content: string | undefined;
        // Read text content for source and config files
        if (['.cs', '.json', '.xml', '.csproj', '.md', '.txt', '.sln', '.slnx'].includes(ext)) {
          try {
            content = fs.readFileSync(fullPath, 'utf-8');
          } catch {
            content = '';
          }
        }

        items.push({
          id: `file-${relativePath}`,
          name: entry.name,
          path: fullPath,
          relativePath,
          extension: ext,
          isDirectory: false,
          content
        });
      }
    }

    return items;
  }
}
