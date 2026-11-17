# Third-party components

SharpForge's MIT license covers its original code. Dependencies and user-imported packages retain their own licenses. SharpForge is an independent project and is not endorsed by Microsoft, Samsung or JetBrains.

The app uses Electron, React, Monaco Editor, node-pty, xterm.js, Lucide, Motion, JSZip and other npm dependencies. Preserve their distributed LICENSE/NOTICE files when packaging. `package-lock.json` records resolved npm dependencies; it is not a complete license clearance. Before distributing a binary, inventory the packaged contents and include all applicable notices, including transitive/native dependencies and artwork. General VS Code/JetBrains extension execution is unsupported; imported themes retain their original licenses.

## netcoredbg

When bundling Samsung netcoredbg, include its release's third-party notices as well as the following upstream license. The debugger's dependencies may carry additional notices.

MIT License

Copyright (c) 2017 Samsung Electronics Co., LTD

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.

## Advanced tools dependencies

The workbench additionally uses React Flow, Dagre, grpc-js, proto-loader, protobufjs, ws, YAML, fast-xml-parser and Croner. Their distributed licenses/notices must accompany redistributed code. The optional semantic helper restores Microsoft.Build.Locator and Microsoft.CodeAnalysis workspace packages from NuGet on the developer machine; retain their package licenses/notices when distributing compiled helper binaries. These additions do not replace the required packaged dependency inventory.
