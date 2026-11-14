import { spawn, ChildProcess } from 'child_process';
import { EventEmitter } from 'events';
import * as path from 'path';
import * as fs from 'fs';
import { Breakpoint, StackFrame, VariableItem } from '../types/minirider';

/**
 * DebuggerManager manages DAP (Debug Adapter Protocol) communication with netcoredbg.
 * netcoredbg is Samsung's MIT-licensed, open-source debugger for CoreCLR / .NET on macOS.
 * It strictly avoids proprietary Microsoft vsdbg binaries that have restrictive licenses.
 */
export class DebuggerManager extends EventEmitter {
  private debugProcess: ChildProcess | null = null;
  private seq = 1;
  private pendingRequests = new Map<number, { resolve: (res: any) => void; reject: (err: any) => void }>();
  private buffer = '';
  private currentThreadId = 1;
  private isPaused = false;

  constructor(private customNetCoreDbgPath?: string) {
    super();
  }

  /**
   * Resolves the path to the netcoredbg executable
   */
  public resolveDebuggerBinary(): string {
    if (this.customNetCoreDbgPath && fs.existsSync(this.customNetCoreDbgPath)) {
      return this.customNetCoreDbgPath;
    }

    // Check project bin directory
    const projectBin = path.resolve(process.cwd(), 'bin', 'netcoredbg', 'netcoredbg');
    if (fs.existsSync(projectBin)) {
      return projectBin;
    }

    // Check Homebrew /usr/local/bin or /opt/homebrew/bin
    const brewArm = '/opt/homebrew/bin/netcoredbg';
    if (fs.existsSync(brewArm)) return brewArm;

    const brewIntel = '/usr/local/bin/netcoredbg';
    if (fs.existsSync(brewIntel)) return brewIntel;

    // Default to PATH
    return 'netcoredbg';
  }

  /**
   * Start netcoredbg in DAP interpreter mode (--interpreter=vscode)
   */
  public async startSession(targetDllPath: string, args: string[] = [], cwd?: string, env?: Record<string, string>): Promise<void> {
    const netcoredbgPath = this.resolveDebuggerBinary();
    this.seq = 1;
    this.buffer = '';

    this.debugProcess = spawn(netcoredbgPath, ['--interpreter=vscode'], {
      cwd: cwd || path.dirname(targetDllPath),
      env: { ...process.env, ...env },
      shell: false
    });

    this.debugProcess.stdout?.on('data', (chunk: Buffer) => this.handleData(chunk.toString()));
    this.debugProcess.stderr?.on('data', (chunk: Buffer) => {
      this.emit('output', { category: 'stderr', output: chunk.toString() });
    });

    this.debugProcess.on('close', code => {
      this.emit('terminated', { exitCode: code });
      this.debugProcess = null;
      this.isPaused = false;
    });

    // 1. Initialize DAP handshake
    await this.sendRequest('initialize', {
      clientID: 'sharpforge-macos',
      clientName: 'SharpForge IDE',
      adapterID: 'coreclr',
      pathFormat: 'path',
      linesStartAt1: true,
      columnsStartAt1: true,
      supportsVariableType: true,
      supportsRunInTerminalRequest: true
    });

    // 2. Launch target assembly
    await this.sendRequest('launch', {
      program: targetDllPath,
      args,
      cwd: cwd || path.dirname(targetDllPath),
      stopAtEntry: false,
      env
    });

    // 3. Configuration done
    await this.sendRequest('configurationDone', {});
  }

  /**
   * Sync breakpoints with the DAP engine
   */
  public async setBreakpoints(filePath: string, breakpoints: Breakpoint[]): Promise<any> {
    return this.sendRequest('setBreakpoints', {
      source: { path: filePath },
      breakpoints: breakpoints.map(b => ({
        line: b.line,
        condition: b.condition
      }))
    });
  }

  /**
   * Stepping operations
   */
  public async continue(): Promise<any> {
    this.isPaused = false;
    return this.sendRequest('continue', { threadId: this.currentThreadId });
  }

  public async next(): Promise<any> {
    this.isPaused = false;
    return this.sendRequest('next', { threadId: this.currentThreadId });
  }

  public async stepIn(): Promise<any> {
    this.isPaused = false;
    return this.sendRequest('stepIn', { threadId: this.currentThreadId });
  }

  public async stepOut(): Promise<any> {
    this.isPaused = false;
    return this.sendRequest('stepOut', { threadId: this.currentThreadId });
  }

  public async stop(): Promise<any> {
    if (this.debugProcess) {
      await this.sendRequest('disconnect', { restart: false }).catch(() => {});
      this.debugProcess.kill();
      this.debugProcess = null;
      this.isPaused = false;
    }
  }

  /**
   * Query Call Stack
   */
  public async getStackTrace(threadId?: number): Promise<StackFrame[]> {
    const res = await this.sendRequest('stackTrace', {
      threadId: threadId || this.currentThreadId,
      startFrame: 0,
      levels: 20
    });

    if (!res.body || !res.body.stackFrames) return [];
    return res.body.stackFrames.map((f: any) => ({
      id: f.id,
      name: f.name,
      file: f.source?.path || 'unknown',
      line: f.line,
      column: f.column
    }));
  }

  /**
   * Inspect variables for the current stack frame
   */
  public async getScopesAndVariables(frameId: number): Promise<VariableItem[]> {
    const scopesRes = await this.sendRequest('scopes', { frameId });
    if (!scopesRes.body?.scopes?.length) return [];

    const localsScope = scopesRes.body.scopes.find((s: any) => s.name === 'Locals') || scopesRes.body.scopes[0];
    const varsRes = await this.sendRequest('variables', { variablesReference: localsScope.variablesReference });

    if (!varsRes.body?.variables) return [];
    return varsRes.body.variables.map((v: any) => ({
      name: v.name,
      value: v.value,
      type: v.type || 'object'
    }));
  }

  /**
   * Evaluate expression in REPL or Watch
   */
  public async evaluateExpression(expression: string, frameId?: number): Promise<string> {
    const res = await this.sendRequest('evaluate', {
      expression,
      frameId,
      context: 'repl'
    });
    return res.body?.result ?? '<no result>';
  }

  /**
   * Handle incoming raw DAP chunks (Content-Length: ... \r\n\r\n { ... })
   */
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
      if (this.buffer.length < bodyStart + contentLength) {
        // Incomplete message, wait for more data
        break;
      }

      const bodyStr = this.buffer.substring(bodyStart, bodyStart + contentLength);
      this.buffer = this.buffer.substring(bodyStart + contentLength);

      try {
        const msg = JSON.parse(bodyStr);
        this.processDapMessage(msg);
      } catch (err) {
        console.error('Failed to parse DAP JSON:', err);
      }
    }
  }

  private processDapMessage(msg: any) {
    if (msg.type === 'response') {
      const handler = this.pendingRequests.get(msg.request_seq);
      if (handler) {
        this.pendingRequests.delete(msg.request_seq);
        if (msg.success) handler.resolve(msg);
        else handler.reject(new Error(msg.message || 'DAP request failed'));
      }
    } else if (msg.type === 'event') {
      if (msg.event === 'stopped') {
        this.isPaused = true;
        this.currentThreadId = msg.body?.threadId || 1;
        this.emit('stopped', msg.body);
      } else if (msg.event === 'continued') {
        this.isPaused = false;
        this.emit('continued', msg.body);
      } else if (msg.event === 'output') {
        this.emit('output', msg.body);
      } else if (msg.event === 'terminated') {
        this.isPaused = false;
        this.emit('terminated', msg.body);
      }
    }
  }

  private sendRequest(command: string, args: any): Promise<any> {
    return new Promise((resolve, reject) => {
      if (!this.debugProcess) {
        return reject(new Error('Debugger process is not active'));
      }

      const seq = this.seq++;
      const msg = {
        seq,
        type: 'request',
        command,
        arguments: args
      };

      const json = JSON.stringify(msg);
      const payload = `Content-Length: ${Buffer.byteLength(json, 'utf-8')}\r\n\r\n${json}`;

      this.pendingRequests.set(seq, { resolve, reject });
      this.debugProcess.stdin?.write(payload);
    });
  }
}
