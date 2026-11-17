# Release checks and remaining work

## Automated validation

Run `npm ci`, `npm test`, `npm run lint`, `npm run build` and `node --check electron-main.cjs`. CI runs the first four on Linux. This does not verify macOS behavior or .NET/debugger compatibility.

## macOS acceptance checks

- Open both solution formats, edit and save, restart and verify the saved file.
- Cancel execution trust and verify no build/restore/test/command starts; trust a known workspace and retry.
- Run a sample app that prints a nested exception with source symbols; check the workbench groups repeated failures and navigates to the correct source line.
- Reproduce an exception under netcoredbg; verify exception details when supported and graceful fallback otherwise.
- Exit with nonzero status without an exception; verify an exit-code report without a guessed cause.
- Save a task, reopen the workbench and restart the app; verify it remains scoped to the same workspace and never runs automatically.
- Import an Open VSX theme; confirm unsupported extensions and broken downloads fail clearly.
- Check editor workers, completion and clipboard with the new CSP/sandbox enabled. The development CSP may need separate configuration for Vite HMR.
- With Claude absent, verify only a shell opens. With a working Claude CLI installed, verify Claude opens by default, authentication works and its permission prompts remain intact. Open two shells, type independently, resize, close one and verify the other stays running.
- Verify Apple Silicon and Intel packaging with the intended SDK/debugger versions.

## Not yet completed

- Full LSP integration in the active runtime, byte-safe framing/timeouts for the older TypeScript protocol managers.
- Argument-array migration for the remaining renderer-generated dotnet/decompiler commands; the integrated terminal remains an intentional shell.
- Scope file IPC to explicitly granted workspace/external files with symlink-aware checks.
- Artifact digests, safe temporary downloads, bounded archive extraction and removal of quarantine-bypass behavior in legacy installer helpers.
- Native Electron process-crash recovery and durable incident history; current reports depend on captured managed output.
- File-conflict detection and unsaved-buffer recovery across crashes.
- Complete packaged dependency/theme/artwork license inventory and ownership verification; the notice file is a starting point, not legal clearance.
- Signed, hardened, notarized macOS distribution and verified updates. Current packaging is for local unsigned testing.
- Real-world performance benchmarks, accessibility review and native macOS/Electron end-to-end tests beyond the browser coverage.

## Further productivity roadmap

After the above acceptance checks: solution-wide semantic editor refactors, coverage-based per-test impact selection, OAuth/refresh workflows for API collections, watch-value diffs between debugger stops, exception-breakpoint controls, and cancellable build/test task pipelines. These need verified runtime support rather than UI-only compatibility claims.

## Advanced-tools acceptance

Run the separate browser and .NET integration checks described in ADVANCED_TOOLS.md. On macOS, verify secure token storage refuses insecure fallback, live log rotation works, Roslyn can load the intended SDK/configuration, C# colors remain distinct, and the workbench Close/Escape controls remain clickable around the native title bar.
