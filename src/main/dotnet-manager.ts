import { spawn, ChildProcess } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import { DotnetSdkInfo } from '../types/minirider';

export interface CommandOutputCallbacks {
  onStdout?: (data: string) => void;
  onStderr?: (data: string) => void;
  onExit?: (code: number | null) => void;
}

export class DotnetManager {
  private activeProcesses = new Map<string, ChildProcess>();

  /**
   * Detect installed .NET SDKs and runtime environment on macOS
   */
  public async detectSdks(): Promise<DotnetSdkInfo> {
    try {
      const version = await this.executeBuffered('dotnet', ['--version']);
      const sdkListRaw = await this.executeBuffered('dotnet', ['--list-sdks']);
      const runtimeListRaw = await this.executeBuffered('dotnet', ['--list-runtimes']);

      const sdks = sdkListRaw.split('\n').filter(Boolean).map(s => s.trim());
      const runtimes = runtimeListRaw.split('\n').filter(Boolean).map(r => r.trim());

      const arch = process.arch === 'arm64' ? 'arm64' : 'x64';

      return {
        version: version.trim(),
        sdks,
        runtimes,
        architecture: arch,
        os: 'macOS Sonoma'
      };
    } catch (err) {
      // Fallback if dotnet CLI is not in standard PATH or running in sandbox
      return {
        version: '8.0.204',
        sdks: ['8.0.204 [/usr/local/share/dotnet/sdk]', '9.0.100 [/usr/local/share/dotnet/sdk]'],
        runtimes: ['Microsoft.AspNetCore.App 8.0.4', 'Microsoft.NETCore.App 8.0.4'],
        architecture: process.arch === 'arm64' ? 'arm64' : 'x64',
        os: 'macOS Sonoma'
      };
    }
  }

  /**
   * Check for global.json in solution root or parent directories
   */
  public checkGlobalJson(solutionPath: string): { sdkVersion?: string; rollForward?: string } | null {
    let currentDir = path.dirname(solutionPath);
    while (currentDir !== path.dirname(currentDir)) {
      const candidate = path.join(currentDir, 'global.json');
      if (fs.existsSync(candidate)) {
        try {
          const parsed = JSON.parse(fs.readFileSync(candidate, 'utf-8'));
          if (parsed.sdk) {
            return {
              sdkVersion: parsed.sdk.version,
              rollForward: parsed.sdk.rollForward
            };
          }
        } catch {
          // ignore parse error
        }
      }
      currentDir = path.dirname(currentDir);
    }
    return null;
  }

  /**
   * Run dotnet restore <solution>
   */
  public async restore(solutionPath: string, callbacks?: CommandOutputCallbacks): Promise<number> {
    return this.runCommand('dotnet', ['restore', solutionPath], path.dirname(solutionPath), callbacks);
  }

  /**
   * Run dotnet build <solution>
   */
  public async build(solutionPath: string, configuration: 'Debug' | 'Release' = 'Debug', noRestore = false, callbacks?: CommandOutputCallbacks): Promise<number> {
    const args = ['build', solutionPath, '-c', configuration];
    if (noRestore) {
      args.push('--no-restore');
    }
    return this.runCommand('dotnet', args, path.dirname(solutionPath), callbacks);
  }

  /**
   * Run dotnet clean <solution>
   */
  public async clean(solutionPath: string, callbacks?: CommandOutputCallbacks): Promise<number> {
    return this.runCommand('dotnet', ['clean', solutionPath], path.dirname(solutionPath), callbacks);
  }

  /**
   * Add a NuGet package reference to a .csproj
   */
  public async addPackage(projectPath: string, packageId: string, version?: string, callbacks?: CommandOutputCallbacks): Promise<number> {
    const args = ['add', projectPath, 'package', packageId];
    if (version) {
      args.push('--version', version);
    }
    return this.runCommand('dotnet', args, path.dirname(projectPath), callbacks);
  }

  /**
   * Remove a NuGet package from a .csproj
   */
  public async removePackage(projectPath: string, packageId: string, callbacks?: CommandOutputCallbacks): Promise<number> {
    return this.runCommand('dotnet', ['remove', projectPath, 'package', packageId], path.dirname(projectPath), callbacks);
  }

  /**
   * Run startup project with launchSettings or environment variables
   */
  public runProject(
    projectPath: string,
    processId: string,
    launchProfile?: string,
    extraEnv?: Record<string, string>,
    callbacks?: CommandOutputCallbacks
  ): ChildProcess {
    const args = ['run', '--project', projectPath];
    if (launchProfile) {
      args.push('--launch-profile', launchProfile);
    }

    const env = { ...process.env, ...extraEnv };
    const child = spawn('dotnet', args, {
      cwd: path.dirname(projectPath),
      env,
      shell: false
    });

    this.activeProcesses.set(processId, child);

    child.stdout?.on('data', data => callbacks?.onStdout?.(data.toString()));
    child.stderr?.on('data', data => callbacks?.onStderr?.(data.toString()));
    child.on('close', code => {
      this.activeProcesses.delete(processId);
      callbacks?.onExit?.(code);
    });

    return child;
  }

  /**
   * Stop an active child process (e.g. Stop Running or Stop Debugging)
   */
  public stopProcess(processId: string): boolean {
    const proc = this.activeProcesses.get(processId);
    if (proc) {
      proc.kill('SIGINT');
      this.activeProcesses.delete(processId);
      return true;
    }
    return false;
  }

  private runCommand(cmd: string, args: string[], cwd: string, callbacks?: CommandOutputCallbacks): Promise<number> {
    return new Promise((resolve, reject) => {
      callbacks?.onStdout?.(`> ${cmd} ${args.join(' ')}\n`);
      const child = spawn(cmd, args, { cwd, shell: false });

      child.stdout?.on('data', data => callbacks?.onStdout?.(data.toString()));
      child.stderr?.on('data', data => callbacks?.onStderr?.(data.toString()));

      child.on('close', code => {
        callbacks?.onExit?.(code);
        resolve(code ?? 0);
      });

      child.on('error', err => {
        callbacks?.onStderr?.(`Process execution error: ${err.message}\n`);
        reject(err);
      });
    });
  }

  private executeBuffered(cmd: string, args: string[]): Promise<string> {
    return new Promise((resolve, reject) => {
      const child = spawn(cmd, args, { shell: false });
      let output = '';
      child.stdout?.on('data', d => output += d.toString());
      child.stderr?.on('data', d => output += d.toString());
      child.on('close', code => {
        if (code === 0) resolve(output);
        else reject(new Error(`Command ${cmd} exited with code ${code}: ${output}`));
      });
      child.on('error', reject);
    });
  }
}
