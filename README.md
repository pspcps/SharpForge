# SharpForge — Lightweight C#/.NET IDE for macOS

SharpForge is a lightweight, open-source .NET IDE designed for everyday C# and .NET development on macOS without commercial license requirements or proprietary subscriptions.

SharpForge lets you open existing `.sln` and `.slnx` solutions, evaluate project graphs, restore NuGet dependencies, build, run, debug via the Debug Adapter Protocol (DAP), execute xUnit / NUnit / MSTest suites, and navigate code with Roslyn-based language intelligence.

---

## Key Features

- **Solution Explorer (.sln & .slnx)**: Full support for both classic Visual Studio format and modern .NET 9 XML-based `.slnx` solutions. Displays project trees, target frameworks, frameworks, and NuGet package references.
- **Auto Setup & SDK Detection**: Detects installed .NET 8 / 9 / 10 SDKs via `dotnet --list-sdks`, evaluates `global.json`, and restores NuGet dependencies automatically.
- **Monaco Code Editor**: Pro C# editing experience with semantic syntax highlighting, gutter breakpoints, diagnostics squigglies, and autocomplete.
- **Real DAP Debugger (netcoredbg)**: Connected to Samsung's open-source, MIT-licensed `netcoredbg` debugger for CoreCLR. Strictly avoids Microsoft proprietary debugger binaries (`vsdbg`) that carry commercial redistribution restrictions.
  - Breakpoints (toggle with `F9`, source & conditional breakpoints)
  - Stepping: Continue (`F5`), Step Over (`F10`), Step Into (`F11`), Step Out (`Shift+F11`), Stop (`Shift+F5`)
  - Variables & Locals inspection with hierarchical object graphs
  - Watch expressions & Debug Console REPL
  - Call Stack navigation
- **Unit Test Explorer**: Discovers and runs tests across solution projects using `dotnet test`. Filter by status or test name, inspect execution durations, view assertions, and debug individual test methods.
- **Roslyn Language Services**: Go to Definition (`F12` / `Cmd+Click`), Find All References / Usages (`Shift+F12`), hover tooltips, and real-time compile diagnostics.
- **macOS Native Integration**:
  - Finder integration (`Reveal in Finder`, double-click solution to open in SharpForge)
  - Window styling matching macOS Sonoma & Sequoia guidelines
  - Quick Open (`Cmd+P`) for instantaneous fuzzy file navigation
  - Packaged as a native `.app` bundle for Apple Silicon (`arm64`) and Intel (`x64`) Macs.
- **NuGet Package Manager**: Search and manage dependencies directly in the IDE with automatic `.csproj` editing and restore execution.
- **Integrated Terminal**: Built-in shell supporting `dotnet`, `git`, and shell commands.

---

## macOS Quickstart & Automated Installation

To set up, build, and package SharpForge into your `/Applications` directory, clone the repository and run the setup script:

```bash
git clone <repository-url>
cd sharpforge
chmod +x setup.sh
./setup.sh
```

### What `setup.sh` does automatically:
1. Detects macOS and architecture: **Apple Silicon (`arm64`)** vs **Intel (`x64`)**.
2. Checks for Xcode Command Line Tools, Node.js 18+, npm, Git, and .NET SDK.
3. Automatically offers to install missing requirements via Homebrew.
4. Downloads or links the MIT-licensed open-source **`netcoredbg`** binary for your Mac's architecture.
5. Runs `npm install` and compiles the Electron and React codebase.
6. Packages the application bundle into `dist/SharpForge.app` using `electron-builder`.
7. Installs `SharpForge.app` to `/Applications` or `~/Applications`.
8. Launches SharpForge ready for development.

---

## Architecture Overview

```
                      ┌────────────────────────────────────────┐
                      │         SharpForge macOS App           │
                      │  Electron + React + Monaco Editor      │
                      └──────────────────┬─────────────────────┘
                                         │
                 ┌───────────────────────┼────────────────────────┐
                 ▼                       ▼                        ▼
      ┌──────────────────────┐ ┌───────────────────┐    ┌──────────────────┐
      │   Solution Manager   │ │  Roslyn LSP Client│    │    DAP Client    │
      │   .sln / .slnx       │ │  csharp-ls / Roslyn│   │    netcoredbg    │
      │   MSBuild evaluation │ │  LSP JSON-RPC     │    │    (MIT License) │
      └──────────┬───────────┘ └─────────┬─────────┘    └─────────┬────────┘
                 │                       │                        │
                 ▼                       ▼                        ▼
      ┌──────────────────────┐ ┌───────────────────┐    ┌──────────────────┐
      │      dotnet CLI      │ │     C# Source     │    │ Target Assembly  │
      │  build/restore/test  │ │     Files         │    │ CoreCLR Runtime  │
      └──────────────────────┘ └───────────────────┘    └──────────────────┘
```

---

## Debugger Licensing & Compliance

A primary requirement of SharpForge is legal redistributability on macOS:
- Microsoft's `vsdbg` debugger binaries and the C# Dev Kit contain proprietary licenses restricting use exclusively to official Microsoft products.
- SharpForge integrates **`netcoredbg`**, Samsung's MIT-licensed, open-source debugger for .NET Core / CoreCLR.
- Language intelligence is provided via standard open-source Roslyn LSP implementations (`csharp-ls` or OmniSharp).

---

## Keyboard Shortcuts

| Action | Shortcut |
|---|---|
| **Start / Continue Debugging** | `F5` |
| **Toggle Breakpoint** | `F9` |
| **Step Over** | `F10` |
| **Step Into** | `F11` |
| **Step Out** | `Shift + F11` |
| **Stop Debugging** | `Shift + F5` |
| **Build Solution** | `Cmd + Shift + B` |
| **Run Startup Project** | `Cmd + R` |
| **Quick Open File** | `Cmd + P` |
| **Go to Definition** | `F12` or `Cmd + Click` |
| **Find All References** | `Shift + F12` |
| **Search Across Solution** | `Cmd + Shift + F` |

---

## License

MIT License. Designed and crafted for developers building modern .NET on macOS.
