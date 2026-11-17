import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SolutionManager } from '../src/main/solution-manager';
for (const format of ['sln', 'slnx']) {
  test(`parses a real ${format} solution and project dependencies`, async () => {
    const root = mkdtempSync(join(tmpdir(), 'sharpforge-'));
    try {
      mkdirSync(join(root, 'App'));
      writeFileSync(join(root, 'App', 'App.csproj'), '<Project Sdk="Microsoft.NET.Sdk"><PropertyGroup><TargetFramework>net8.0</TargetFramework><OutputType>Exe</OutputType></PropertyGroup><ItemGroup><PackageReference Include="Example" Version="1.2.3" /></ItemGroup></Project>');
      writeFileSync(join(root, 'App', 'Program.cs'), 'class Program {}');
      const path = join(root, `Example.${format}`);
      writeFileSync(path, format === 'slnx' ? '<Solution><Project Path="App/App.csproj" /></Solution>' : 'Project("{FAE04EC0-301F-11D3-BF4B-00C04F79EFBC}") = "App", "App\\App.csproj", "{00000000-0000-0000-0000-000000000001}"\nEndProject');
      const solution = await new SolutionManager().loadSolution(path);
      assert.equal(solution.projects.length, 1);
      assert.equal(solution.projects[0].targetFramework, 'net8.0');
      assert.equal(solution.projects[0].dependencies.packages[0].version, '1.2.3');
    } finally { rmSync(root, { recursive: true, force: true }); }
  });
}
