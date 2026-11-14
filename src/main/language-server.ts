import { spawn, ChildProcess } from 'child_process';
import { EventEmitter } from 'events';
import * as path from 'path';
import * as fs from 'fs';
import { DiagnosticItem, ReferenceItem } from '../types/minirider';

/**
 * LanguageServerManager manages JSON-RPC LSP communication with Roslyn-based C# language servers
 * such as csharp-ls or OmniSharp (both MIT-licensed open-source solutions).
 */
export class LanguageServerManager extends EventEmitter {
  private lspProcess: ChildProcess | null = null;
  private id = 1;
  private pendingRequests = new Map<number, { resolve: (res: any) => void; reject: (err: any) => void }>();
  private buffer = '';
  private openDocuments = new Map<string, number>();

  constructor(private customLspBinaryPath?: string) {
    super();
  }

  /**
   * Resolves the C# LSP binary (e.g., csharp-ls or OmniSharp)
   */
  public resolveLspBinary(): string {
    if (this.customLspBinaryPath && fs.existsSync(this.customLspBinaryPath)) {
      return this.customLspBinaryPath;
    }

    // Check dotnet global tool for csharp-ls (~/.dotnet/tools/csharp-ls)
    const homeDir = process.env.HOME || '';
    const globalTool = path.join(homeDir, '.dotnet', 'tools', 'csharp-ls');
    if (fs.existsSync(globalTool)) return globalTool;

    return 'csharp-ls';
  }

  /**
   * Initializes the language server for the workspace
   */
  public async startServer(solutionPath: string): Promise<void> {
    const binary = this.resolveLspBinary();
    const workspaceRoot = path.dirname(solutionPath);

    this.id = 1;
    this.buffer = '';

    this.lspProcess = spawn(binary, ['--solution', solutionPath], {
      cwd: workspaceRoot,
      shell: false
    });

    this.lspProcess.stdout?.on('data', (chunk: Buffer) => this.handleData(chunk.toString()));
    this.lspProcess.stderr?.on('data', (chunk: Buffer) => {
      this.emit('log', chunk.toString());
    });

    this.lspProcess.on('close', code => {
      this.emit('exit', code);
      this.lspProcess = null;
    });

    // Initialize LSP handshake
    await this.sendRequest('initialize', {
      processId: process.pid,
      rootUri: `file://${workspaceRoot}`,
      capabilities: {
        textDocument: {
          completion: { dynamicRegistration: true },
          hover: { dynamicRegistration: true },
          definition: { dynamicRegistration: true },
          implementation: { dynamicRegistration: true },
          references: { dynamicRegistration: true },
          documentSymbol: { dynamicRegistration: true },
          publishDiagnostics: { relatedInformation: true }
        }
      }
    });

    this.sendNotification('initialized', {});
  }

  /**
   * Notify server that document is opened
   */
  public didOpen(filePath: string, content: string): void {
    this.openDocuments.set(filePath, 1);
    this.sendNotification('textDocument/didOpen', {
      textDocument: {
        uri: `file://${filePath}`,
        languageId: 'csharp',
        version: 1,
        text: content
      }
    });
  }

  /**
   * Notify document content changed
   */
  public didChange(filePath: string, newContent: string): void {
    const version = (this.openDocuments.get(filePath) || 1) + 1;
    this.openDocuments.set(filePath, version);

    this.sendNotification('textDocument/didChange', {
      textDocument: {
        uri: `file://${filePath}`,
        version
      },
      contentChanges: [{ text: newContent }]
    });
  }

  /**
   * Request definition (Go to Definition - F12 / Cmd+Click)
   */
  public async getDefinition(filePath: string, line: number, character: number): Promise<{ file: string; line: number; character: number } | null> {
    const res = await this.sendRequest('textDocument/definition', {
      textDocument: { uri: `file://${filePath}` },
      position: { line: line - 1, character }
    });

    if (!res) return null;
    const target = Array.isArray(res) ? res[0] : res;
    if (!target) return null;

    const file = target.uri ? target.uri.replace('file://', '') : filePath;
    return {
      file,
      line: (target.range?.start?.line ?? 0) + 1,
      character: target.range?.start?.character ?? 0
    };
  }

  /**
   * Request implementation (Go to Implementation - Opt+Cmd+B / Cmd+F12)
   */
  public async getImplementation(filePath: string, line: number, character: number): Promise<{ file: string; line: number; character: number }[] | null> {
    const res = await this.sendRequest('textDocument/implementation', {
      textDocument: { uri: `file://${filePath}` },
      position: { line: line - 1, character }
    });

    if (!res) return null;
    const targets = Array.isArray(res) ? res : [res];
    if (targets.length === 0) return null;

    return targets.map((target: any) => ({
      file: target.uri ? target.uri.replace('file://', '') : filePath,
      line: (target.range?.start?.line ?? 0) + 1,
      character: target.range?.start?.character ?? 0
    }));
  }

  /**
   * Request references (Find Usages across projects)
   */
  public async getReferences(filePath: string, line: number, character: number): Promise<ReferenceItem[]> {
    const res = await this.sendRequest('textDocument/references', {
      textDocument: { uri: `file://${filePath}` },
      position: { line: line - 1, character },
      context: { includeDeclaration: true }
    });

    if (!Array.isArray(res)) return [];
    return res.map(ref => ({
      file: ref.uri.replace('file://', ''),
      line: (ref.range?.start?.line ?? 0) + 1,
      column: (ref.range?.start?.character ?? 0) + 1,
      preview: `Reference at ${path.basename(ref.uri)}:${(ref.range?.start?.line ?? 0) + 1}`
    }));
  }

  /**
   * Request hover documentation
   */
  public async getHover(filePath: string, line: number, character: number): Promise<string | null> {
    const res = await this.sendRequest('textDocument/hover', {
      textDocument: { uri: `file://${filePath}` },
      position: { line: line - 1, character }
    });

    if (!res || !res.contents) return null;
    if (typeof res.contents === 'string') return res.contents;
    if (res.contents.value) return res.contents.value;
    if (Array.isArray(res.contents)) {
      return res.contents.map((c: any) => typeof c === 'string' ? c : c.value).join('\n');
    }
    return null;
  }

  /**
   * Request completions (IntelliSense)
   */
  public async getCompletions(filePath: string, line: number, character: number): Promise<any[]> {
    const res = await this.sendRequest('textDocument/completion', {
      textDocument: { uri: `file://${filePath}` },
      position: { line: line - 1, character }
    });

    if (!res) return [];
    return Array.isArray(res) ? res : res.items || [];
  }

  /**
   * Stop LSP server
   */
  public async shutdown(): Promise<void> {
    if (this.lspProcess) {
      await this.sendRequest('shutdown', {}).catch(() => {});
      this.sendNotification('exit', {});
      this.lspProcess.kill();
      this.lspProcess = null;
    }
  }

  private handleData(data: string) {
    this.buffer += data;
    while (true) {
      const headerEnd = this.buffer.indexOf('\r\n\r\n');
      if (headerEnd === -1) break;

      const header = this.buffer.substring(0, headerEnd);
      const match = header.match(/Content-Length:\s*(\d+)/i);
      if (!match) {
        this.buffer = this.buffer.substring(headerEnd + 4);
        continue;
      }

      const contentLength = parseInt(match[1], 10);
      const bodyStart = headerEnd + 4;
      if (this.buffer.length < bodyStart + contentLength) break;

      const bodyStr = this.buffer.substring(bodyStart, bodyStart + contentLength);
      this.buffer = this.buffer.substring(bodyStart + contentLength);

      try {
        const msg = JSON.parse(bodyStr);
        this.processLspMessage(msg);
      } catch (err) {
        console.error('Failed to parse LSP JSON:', err);
      }
    }
  }

  private processLspMessage(msg: any) {
    if (msg.id !== undefined && this.pendingRequests.has(msg.id)) {
      const handler = this.pendingRequests.get(msg.id)!;
      this.pendingRequests.delete(msg.id);
      if (msg.error) handler.reject(new Error(msg.error.message || 'LSP error'));
      else handler.resolve(msg.result);
    } else if (msg.method === 'textDocument/publishDiagnostics') {
      const params = msg.params;
      const file = params.uri.replace('file://', '');
      const diagnostics: DiagnosticItem[] = params.diagnostics.map((d: any, idx: number) => ({
        id: `diag-${idx}`,
        code: d.code || 'CS',
        message: d.message,
        file,
        line: (d.range?.start?.line ?? 0) + 1,
        column: (d.range?.start?.character ?? 0) + 1,
        severity: d.severity === 1 ? 'error' : d.severity === 2 ? 'warning' : 'info',
        source: 'Roslyn'
      }));
      this.emit('diagnostics', { file, diagnostics });
    }
  }

  private sendRequest(method: string, params: any): Promise<any> {
    return new Promise((resolve, reject) => {
      if (!this.lspProcess) return reject(new Error('LSP process is not active'));
      const id = this.id++;
      const payload = { jsonrpc: '2.0', id, method, params };
      const json = JSON.stringify(payload);
      const data = `Content-Length: ${Buffer.byteLength(json, 'utf-8')}\r\n\r\n${json}`;

      this.pendingRequests.set(id, { resolve, reject });
      this.lspProcess.stdin?.write(data);
    });
  }

  private sendNotification(method: string, params: any) {
    if (!this.lspProcess) return;
    const payload = { jsonrpc: '2.0', method, params };
    const json = JSON.stringify(payload);
    const data = `Content-Length: ${Buffer.byteLength(json, 'utf-8')}\r\n\r\n${json}`;
    this.lspProcess.stdin?.write(data);
  }
}
