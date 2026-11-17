# Cairn IDE — experimental C#/.NET IDE for macOS

Cairn IDE combines Monaco editing, solution browsing, .NET CLI build/run/test workflows and DAP debugging through Samsung netcoredbg. It is an independent project with no Microsoft, Samsung or JetBrains endorsement.

## Developer workbench

Open **Developer workbench** from the editor to access an interactive dependency explorer and grouped tools for solution intelligence, API testing, logs, Git, testing/quality and local utilities.

The explorer supports project, restored package, type/interface and method-call views with search, zoom/pan, minimap, impact tracing and source navigation. **Resolve with Roslyn** adds compiler-resolved source relationships and displays compilation/load diagnostics.

The API client supports REST, GraphQL, gRPC and WebSockets; logs combine named sources/live streams; Git provides staging, comparison, conflicts and rebase workflows; the quality center executes real .NET tooling and reads coverage. Saved commands, file history, configuration comparisons and exception inspection remain available.

See the [complete tool guide](docs/ADVANCED_TOOLS.md) for individual workflows, evidence limits, credential handling and required SDKs/collectors. [Feature status](docs/FEATURE_STATUS.md) distinguishes these tools from remaining roadmap work.

## Multiple terminals and Claude

The desktop Terminal panel supports independent PTY sessions, keyboard input, ANSI output and resizing. Use **+ Terminal** to open another shell and **×** to terminate a session. Sessions remain alive when switching panel tabs or hiding the panel, and close when you quit the app. Browser preview retains the existing command-output panel.

The default terminal is a regular shell. When a runnable `claude` executable is found in the app's PATH or common native install locations, an **Open Claude** button appears; Claude starts only when you click it. When Claude is unavailable, its controls stay hidden. This uses your local Claude installation and authentication; it does not install Claude, sign in or bypass its permission prompts. Shell aliases/functions are not detected. Native terminal dependencies are rebuilt for Electron during npm's postinstall step; macOS builds require Xcode Command Line Tools.

The toolbar wraps at narrower widths and sidebar badges cap at 99+ while retaining exact counts in their accessible labels. Monaco assets/workers are bundled locally so editor startup does not require a CDN.

## Development

Requirements: Node.js 24 or newer, npm, and a .NET SDK compatible with your projects. macOS is required to verify packaged desktop behavior.

```sh
git clone https://github.com/pspcps/SharpForge.git
cd Cairn IDE
npm ci
npm test
npm run lint
npm run build
```

For desktop development, start `npm run dev` in one terminal and `npm run electron:dev` in another. For local unsigned macOS packaging, run `./setup.sh`. The resulting app and installers are in `release/`; the script does not automatically install it in Applications. Electron and packaging dependencies are pinned in package.json/package-lock.json. npm is the supported installation path.

Configure an installed netcoredbg executable in settings. The existing download helpers are experimental: they still need digest verification and should not be treated as a verified supply chain. Local unsigned builds are not notarized public releases.

## Current capabilities and limits

- Solution browsing for `.sln`/`.slnx`, NuGet operations, build/run/test commands and source navigation.
- DAP debugging, breakpoints, locals, expressions and call-stack inspection, subject to adapter/platform support.
- The active editor uses custom C# navigation/completion providers. The separate TypeScript language-server manager is not connected to the active Electron runtime; complete Roslyn LSP integration remains planned.
- Open VSX **color theme imports** are supported. General VS Code extensions and JetBrains plugins do not execute. Unsupported packages and failed theme imports must not report successful installation.
- The terminal executes shell commands intentionally. Only trust code and commands you understand. Builds, restores and tests can execute project code.

## Security and licensing

Electron web security and sandboxing are enabled. Privileged IPC validates the app's main frame; execution operations require session trust. Navigation/new-window creation is blocked. Git add/commit/diff and background restore/build use argument arrays. File saves use a temporary sibling followed by rename. These are hardening measures, not a complete security audit.

Cairn IDE original code is MIT licensed; see [LICENSE](LICENSE) and [third-party notices](THIRD_PARTY_NOTICES.md). A complete packaged dependency/artwork audit, trademark clearance, signing and notarization remain release requirements. See [release checks](docs/RELEASE_CHECKS.md).
