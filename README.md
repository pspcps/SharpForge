# SharpForge — experimental C#/.NET IDE for macOS

SharpForge combines Monaco editing, solution browsing, .NET CLI build/run/test workflows and DAP debugging through Samsung netcoredbg. It is an independent project with no Microsoft, Samsung or JetBrains endorsement.

## Developer workbench

Click **Exceptions & tasks** in the bottom-right corner of the editor.

- Inspect managed exceptions captured from run/debug output, grouped by type, message and stack.
- View inner exceptions, source locations and framework frames separately from investigation suggestions.
- Click a source frame to open the file at the failing line.
- Copy an exception report or inspect the original text. Review paths and secrets before sharing.
- Jump straight to build, run, debug or rerun failed tests.
- Save named commands per workspace for formatting, migrations, generation and other repetitive tasks. Commands run only on demand; they are stored locally, so do not save secrets.

Nonzero run exits open the workbench. If no managed stack is available, it reports the exit code without guessing a cause. DAP exception stops request exception details when the adapter supports them. React render failures display a recovery screen with details and a reload action.

## Multiple terminals and Claude

The desktop Terminal panel supports independent PTY sessions, keyboard input, ANSI output and resizing. Use **+ Terminal** to open another shell and **×** to terminate a session. Sessions remain alive when switching panel tabs or hiding the panel, and close when you quit the app. Browser preview retains the existing command-output panel.

When a runnable `claude` executable is found in the app's PATH or common native install locations, the initial terminal opens Claude by default. Otherwise only a regular terminal opens; Claude controls stay hidden. This uses your local Claude installation and authentication; it does not install Claude, sign in or bypass its permission prompts. Shell aliases/functions are not detected. Native terminal dependencies are rebuilt for Electron during npm's postinstall step; macOS builds require Xcode Command Line Tools.

The toolbar wraps at narrower widths and sidebar badges cap at 99+ while retaining exact counts in their accessible labels. Monaco assets/workers are bundled locally so editor startup does not require a CDN.

## Development

Requirements: Node.js compatible with Vite 8, npm, and a .NET SDK compatible with your projects. macOS is required to verify packaged desktop behavior.

```sh
git clone https://github.com/pspcps/SharpForge.git
cd SharpForge
npm ci
npm test
npm run lint
npm run build
```

For desktop development, start `npm run dev` in one terminal and `npm run electron:dev` in another. For local unsigned macOS packaging, run `./setup.sh`. The resulting app is in `dist`; the script does not automatically install it in Applications. Electron and packaging dependencies are pinned in package.json/package-lock.json. npm is the supported installation path.

Configure an installed netcoredbg executable in settings. The existing download helpers are experimental: they still need digest verification and should not be treated as a verified supply chain. Local unsigned builds are not notarized public releases.

## Current capabilities and limits

- Solution browsing for `.sln`/`.slnx`, NuGet operations, build/run/test commands and source navigation.
- DAP debugging, breakpoints, locals, expressions and call-stack inspection, subject to adapter/platform support.
- The active editor uses custom C# navigation/completion providers. The separate TypeScript language-server manager is not connected to the active Electron runtime; complete Roslyn LSP integration remains planned.
- Open VSX **color theme imports** are supported. General VS Code extensions and JetBrains plugins do not execute. Unsupported packages and failed theme imports must not report successful installation.
- The terminal executes shell commands intentionally. Only trust code and commands you understand. Builds, restores and tests can execute project code.

## Security and licensing

Electron web security and sandboxing are enabled. Privileged IPC validates the app's main frame; execution operations require session trust. Navigation/new-window creation is blocked. Git add/commit/diff and background restore/build use argument arrays. File saves use a temporary sibling followed by rename. These are hardening measures, not a complete security audit.

SharpForge original code is MIT licensed; see [LICENSE](LICENSE) and [third-party notices](THIRD_PARTY_NOTICES.md). A complete packaged dependency/artwork audit, trademark clearance, signing and notarization remain release requirements. See [release checks](docs/RELEASE_CHECKS.md).
