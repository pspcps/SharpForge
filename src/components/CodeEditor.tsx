import React, { useRef, useEffect, useState } from 'react';
import Editor, { OnMount } from '@monaco-editor/react';
import {
  X,
  FolderSync,
  Save,
  PanelBottom,
  Palette,
  Eye,
  Pencil,
  Sparkles,
  Copy,
  Check,
  ChevronRight,
  ChevronDown,
  LocateFixed,
  Braces,
  Files
} from 'lucide-react';
import {
  SolutionFile,
  SolutionFileItem,
  Breakpoint,
  DiagnosticItem,
  VariableItem
} from '../types/minirider';
import { EditorContextMenu } from './EditorContextMenu';
import {
  resolveCSharpDefinition,
  resolveCSharpImplementations,
  getOrBuildSolutionIndex,
  getCSharpCompletions,
  getCSharpHoverInfo,
  getFileOutlineSymbols
} from '../utils/csharpSymbolNavigator';
import {
  CSHARP_TOKEN_TYPES,
  CSHARP_TOKEN_MODIFIERS,
  buildCSharpSemanticTokens
} from '../utils/csharpSemanticTokens';
import {
  extractCSharpExpressionAtPosition,
  variablesToJsonObject,
  type EvaluatedDebugValue
} from '../utils/debugExpressionHelper';

export type EditorThemeId = 'sharpforge-dark' | 'vs-dark-plus' | 'darcula' | (string & {});

let monacoProvidersRegistered = false;
const uriPathMap = new Map<string, string>();

function makeTargetUri(monaco: any, filePath: string) {
  const safeId = btoa(unescape(encodeURIComponent(filePath))).replace(/[+/=]/g, '_');
  const uri = monaco.Uri.parse(`inmemory://sharpforge/${safeId}`);
  uriPathMap.set(uri.toString(), filePath);
  return uri;
}

interface CodeEditorProps {
  solution?: SolutionFile;
  openFiles: SolutionFileItem[];
  activeFile: SolutionFileItem | null;
  onSelectFile: (file: SolutionFileItem) => void;
  onCloseFile: (file: SolutionFileItem) => void;
  onContentChange: (file: SolutionFileItem, newContent: string) => void;
  onSaveFile?: (file: SolutionFileItem) => void;
  dirtyFileIds?: Set<string>;
  breakpoints: Breakpoint[];
  onToggleBreakpoint: (filePath: string, line: number) => void;
  pausedLocation: { filePath: string; line: number } | null;
  isDebuggingPaused?: boolean;
  onEvaluateDebugExpression?: (
    expression: string,
    context?: 'hover' | 'watch' | 'repl'
  ) => Promise<EvaluatedDebugValue>;
  onExpandDebugVariables?: (variablesReference: number) => Promise<VariableItem[]>;
  onOpenEvaluateModal?: (expression: string, mode?: 'evaluate' | 'setValue') => void;
  onAddWatchExpression?: (expression: string) => void;
  onSetDebugVariableValue?: (payload: {
    expression: string;
    newValue: string;
    variablesReference?: number;
    name?: string;
  }) => Promise<{ success: boolean; value?: string; error?: string }>;
  diagnostics: DiagnosticItem[];
  onFindReferences: (file: SolutionFileItem, line: number, character: number, symbolText?: string) => void;
  onGoToImplementation: (file: SolutionFileItem, line: number, character: number, symbolText?: string) => void;
  onGoToDefinition: (file: SolutionFileItem, line: number, character: number, symbolText?: string) => void;
  onNavigateToFileLocation?: (filePath: string, line: number, column: number) => void;
  onOpenAppSettingsEnv?: (file: SolutionFileItem) => void;
  targetFramework?: string;
  activeLine?: number;
  activeColumn?: number;
  navigationNonce?: number;
  onCursorPositionChange?: (line: number, column: number) => void;
  editorTheme?: EditorThemeId;
  onChangeEditorTheme?: (theme: EditorThemeId) => void;
  customThemes?: Array<{
    id: string;
    label: string;
    uiTheme?: string;
    colors?: Record<string, string>;
    rules?: Array<{ token: string; foreground?: string; fontStyle?: string }>;
  }>;
  onLocateInExplorer?: () => void;
  onCopyAsCurl?: (line: number) => void;
  onCopyExpressionAsJson?: (expression: string) => void;
  isBottomPanelOpen?: boolean;
  onToggleBottomPanel?: () => void;
}

export const CodeEditor: React.FC<CodeEditorProps> = ({
  solution,
  openFiles,
  activeFile,
  onSelectFile,
  onCloseFile,
  onContentChange,
  onSaveFile,
  dirtyFileIds,
  breakpoints,
  onToggleBreakpoint,
  pausedLocation,
  isDebuggingPaused = false,
  onEvaluateDebugExpression,
  onExpandDebugVariables,
  onOpenEvaluateModal,
  onAddWatchExpression,
  onSetDebugVariableValue,
  diagnostics,
  onFindReferences,
  onGoToImplementation,
  onGoToDefinition,
  onNavigateToFileLocation,
  onOpenAppSettingsEnv,
  targetFramework = 'net10.0',
  activeLine,
  activeColumn,
  navigationNonce,
  onCursorPositionChange,
  editorTheme = 'sharpforge-dark',
  onChangeEditorTheme,
  customThemes = [],
  onLocateInExplorer,
  onCopyAsCurl,
  onCopyExpressionAsJson,
  isBottomPanelOpen = true,
  onToggleBottomPanel
}) => {
  const editorRef = useRef<any>(null);
  const monacoRef = useRef<any>(null);
  const editorContainerRef = useRef<HTMLDivElement>(null);
  const decorationsRef = useRef<string[]>([]);
  const suppressNextContextMenuRef = useRef<boolean>(false);
  const pendingJumpRef = useRef<{ filePath: string; line: number; column: number } | null>(null);
  const highlightCollectionRef = useRef<any>(null);

  // Debug Hover / Selection Widget State
  const hoverTimerRef = useRef<number | null>(null);
  const hideHoverTimerRef = useRef<number | null>(null);
  const isPointerInHoverCardRef = useRef<boolean>(false);
  const isEditingHoverValueRef = useRef<boolean>(false);

  const [debugHoverCard, setDebugHoverCard] = useState<{
    expression: string;
    result: string;
    type?: string;
    variablesReference?: number;
    children?: VariableItem[];
    top: number;
    left: number;
    lineNumber: number;
  } | null>(null);
  const [hoverExpandedRefs, setHoverExpandedRefs] = useState<Record<number, VariableItem[]>>({});
  const [isHoverSettingValue, setIsHoverSettingValue] = useState(false);
  const [hoverNewValue, setHoverNewValue] = useState('');
  const [hoverCopied, setHoverCopied] = useState(false);

  // Refs to avoid stale closures inside Monaco event listeners & providers
  const activeFileRef = useRef<SolutionFileItem | null>(activeFile);
  activeFileRef.current = activeFile;

  const solutionRef = useRef<SolutionFile | undefined>(solution);
  solutionRef.current = solution;

  const isDebuggingPausedRef = useRef<boolean>(isDebuggingPaused);
  isDebuggingPausedRef.current = isDebuggingPaused;

  const debugHoverExprRef = useRef<{ expr: string; lineNumber: number } | null>(null);
  debugHoverExprRef.current = debugHoverCard
    ? { expr: debugHoverCard.expression, lineNumber: debugHoverCard.lineNumber }
    : null;

  const callbacksRef = useRef({
    onToggleBreakpoint,
    onGoToImplementation,
    onGoToDefinition,
    onFindReferences,
    onSaveFile,
    onCursorPositionChange,
    onNavigateToFileLocation,
    onEvaluateDebugExpression,
    onOpenEvaluateModal,
    onAddWatchExpression,
    onSetDebugVariableValue
  });
  callbacksRef.current = {
    onToggleBreakpoint,
    onGoToImplementation,
    onGoToDefinition,
    onFindReferences,
    onSaveFile,
    onCursorPositionChange,
    onNavigateToFileLocation,
    onEvaluateDebugExpression,
    onOpenEvaluateModal,
    onAddWatchExpression,
    onSetDebugVariableValue
  };

  const [cursorPos, setCursorPos] = useState<{ line: number; column: number }>({ line: 1, column: 1 });
  const [isTabsDropdownOpen, setIsTabsDropdownOpen] = useState(false);
  const tabsScrollRef = useRef<HTMLDivElement>(null);
  const [contextMenuState, setContextMenuState] = useState<{
    x: number;
    y: number;
    debugExpression: string | null;
    debugPreviewValue: string | null;
    cursorLine: number;
  } | null>(null);

  const formatFrameworkLabel = (tf: string) => {
    const lower = (tf || 'net10.0').toLowerCase();
    if (lower.startsWith('net10')) return '.NET 10.0';
    if (lower.startsWith('net9')) return '.NET 9.0';
    if (lower.startsWith('net8')) return '.NET 8.0';
    if (lower.startsWith('net7')) return '.NET 7.0';
    if (lower.startsWith('net6')) return '.NET 6.0';
    if (lower.startsWith('netstandard')) return tf.replace('netstandard', '.NET Standard ');
    return tf;
  };

  const handleEditorDidMount: OnMount = (editor, monaco) => {
    editorRef.current = editor;
    monacoRef.current = monaco;

    // 1. SharpForge Dark (Default)
    const sharpForgeDarkTheme = {
      base: 'vs-dark',
      inherit: true,
      rules: [
        { token: 'keyword', foreground: 'CF8E6D', fontStyle: 'bold' },
        { token: 'keyword.cs', foreground: 'CF8E6D', fontStyle: 'bold' },
        { token: 'keyword.type', foreground: 'CF8E6D' },
        { token: 'comment', foreground: '7A7E85', fontStyle: 'italic' },
        { token: 'comment.cs', foreground: '7A7E85', fontStyle: 'italic' },
        { token: 'comment.doc', foreground: '5F826B', fontStyle: 'italic' },
        { token: 'string', foreground: '6AAB73' },
        { token: 'string.cs', foreground: '6AAB73' },
        { token: 'number', foreground: '2AACB8' },
        { token: 'number.cs', foreground: '2AACB8' },
        { token: 'identifier', foreground: 'BCBEC4' },
        { token: 'type', foreground: '4EC9B0' },
        { token: 'delimiter', foreground: 'BCBEC4' },
        { token: 'delimiter.curly', foreground: 'BCBEC4' },
        // Semantic token rules
        { token: 'class', foreground: '6FAFBD' },
        { token: 'interface', foreground: '78DCE8' },
        { token: 'struct', foreground: '6FAFBD' },
        { token: 'enum', foreground: 'B5CEA8' },
        { token: 'method', foreground: '56A8F5' },
        { token: 'field', foreground: 'C77DBB' },
        { token: 'property', foreground: 'BCBEC4' },
        { token: 'parameter', foreground: '9CDCFE' },
        { token: 'variable', foreground: 'BCBEC4' },
        { token: 'namespace', foreground: 'A9B7C6' },
        { token: 'decorator', foreground: 'B3AE60' },
        { token: 'keyword.controlFlow', foreground: 'CF8E6D', fontStyle: 'bold' }
      ],
      colors: {
        'editor.background': '#1e1f22',
        'editor.foreground': '#bcbec4',
        'editorLineNumber.foreground': '#4e5157',
        'editorLineNumber.activeForeground': '#a8adbd',
        'editor.selectionBackground': '#214283',
        'editor.lineHighlightBackground': '#26282e',
        'editorGutter.background': '#1e1f22',
        'editorCursor.foreground': '#dfe1e5',
        'editorIndentGuide.background1': '#2b2d30',
        'editorIndentGuide.activeBackground1': '#43454a'
      }
    };
    monaco.editor.defineTheme('sharpforge-dark', sharpForgeDarkTheme);
    monaco.editor.defineTheme('rider-dark', sharpForgeDarkTheme);

    // 2. Visual Studio Dark+ Theme
    monaco.editor.defineTheme('vs-dark-plus', {
      base: 'vs-dark',
      inherit: true,
      rules: [
        { token: 'keyword', foreground: '569CD6', fontStyle: 'bold' },
        { token: 'keyword.cs', foreground: '569CD6' },
        { token: 'comment', foreground: '6A9955', fontStyle: 'italic' },
        { token: 'string', foreground: 'CE9178' },
        { token: 'number', foreground: 'B5CEA8' },
        { token: 'identifier', foreground: 'D4D4D4' },
        { token: 'type', foreground: '4EC9B0' },
        { token: 'class', foreground: '4EC9B0' },
        { token: 'interface', foreground: 'B8D7A3' },
        { token: 'struct', foreground: '86C691' },
        { token: 'enum', foreground: 'B8D7A3' },
        { token: 'method', foreground: 'DCDCAA' },
        { token: 'field', foreground: '9CDCFE' },
        { token: 'property', foreground: 'D4D4D4' },
        { token: 'parameter', foreground: '9CDCFE' },
        { token: 'variable', foreground: '9CDCFE' },
        { token: 'namespace', foreground: 'D4D4D4' },
        { token: 'decorator', foreground: 'D7BA7D' },
        { token: 'keyword.controlFlow', foreground: 'C586C0' }
      ],
      colors: {
        'editor.background': '#1e1e1e',
        'editor.foreground': '#d4d4d4',
        'editorLineNumber.foreground': '#6e7681',
        'editorLineNumber.activeForeground': '#c6c6c6',
        'editor.selectionBackground': '#264f78',
        'editor.lineHighlightBackground': '#2a2d2e',
        'editorGutter.background': '#1e1e1e',
        'editorCursor.foreground': '#aeafad'
      }
    });

    // 3. Classic JetBrains Darcula
    monaco.editor.defineTheme('darcula', {
      base: 'vs-dark',
      inherit: true,
      rules: [
        { token: 'keyword', foreground: 'CC7832', fontStyle: 'bold' },
        { token: 'keyword.cs', foreground: 'CC7832', fontStyle: 'bold' },
        { token: 'comment', foreground: '808080', fontStyle: 'italic' },
        { token: 'string', foreground: '6A8759' },
        { token: 'number', foreground: '6897BB' },
        { token: 'identifier', foreground: 'A9B7C6' },
        { token: 'class', foreground: 'A9B7C6', fontStyle: 'bold' },
        { token: 'interface', foreground: '70AEAB' },
        { token: 'struct', foreground: '6FAFBD' },
        { token: 'enum', foreground: '9876AA' },
        { token: 'method', foreground: 'FFC66D' },
        { token: 'field', foreground: '9876AA' },
        { token: 'property', foreground: 'A9B7C6' },
        { token: 'parameter', foreground: 'A9B7C6' },
        { token: 'variable', foreground: 'A9B7C6' },
        { token: 'namespace', foreground: 'A9B7C6' },
        { token: 'decorator', foreground: 'BBB529' }
      ],
      colors: {
        'editor.background': '#2b2b2b',
        'editor.foreground': '#a9b7c6',
        'editorLineNumber.foreground': '#606366',
        'editorLineNumber.activeForeground': '#a4a3a3',
        'editor.selectionBackground': '#214283',
        'editor.lineHighlightBackground': '#323232',
        'editorGutter.background': '#313335',
        'editorCursor.foreground': '#bbbbbb'
      }
    });

    // Register any custom extension themes before applying active theme
    for (const ct of customThemes) {
      try {
        monaco.editor.defineTheme(ct.id, {
          base: ct.uiTheme === 'vs' ? 'vs' : 'vs-dark',
          inherit: true,
          rules: (ct.rules || []).map(r => ({
            token: r.token,
            foreground: r.foreground,
            fontStyle: r.fontStyle
          })),
          colors: ct.colors || {}
        });
      } catch {}
    }

    monaco.editor.setTheme(editorTheme);

    // Register Monaco C# Semantic Tokens, Definition, Implementation, Completion, Hover & Cross-File Opener once
    if (!monacoProvidersRegistered) {
      monacoProvidersRegistered = true;

      monaco.languages.registerDocumentSemanticTokensProvider('csharp', {
        getLegend: () => ({
          tokenTypes: [...CSHARP_TOKEN_TYPES],
          tokenModifiers: [...CSHARP_TOKEN_MODIFIERS]
        }),
        provideDocumentSemanticTokens: (model: any) => {
          const sol = solutionRef.current;
          const curFile = activeFileRef.current;
          const data = buildCSharpSemanticTokens(
            model.getValue(),
            sol,
            curFile?.path || model.uri?.path
          );
          return { data, resultId: undefined };
        },
        releaseDocumentSemanticTokens: () => {}
      });

      monaco.languages.registerDefinitionProvider('csharp', {
        provideDefinition: (model: any, position: any) => {
          const sol = solutionRef.current;
          const curFile = activeFileRef.current;
          if (!sol || !curFile) return null;

          const wordInfo = model.getWordAtPosition(position);
          const { targets } = resolveCSharpDefinition(
            sol,
            curFile,
            position.lineNumber,
            position.column,
            wordInfo?.word
          );
          if (targets.length === 0) return null;

          return targets.map(t => ({
            uri: makeTargetUri(monaco, t.file),
            range: new monaco.Range(t.line, t.column, t.line, t.column + Math.max(1, (wordInfo?.word || t.name).length))
          }));
        }
      });

      monaco.languages.registerImplementationProvider('csharp', {
        provideImplementation: (model: any, position: any) => {
          const sol = solutionRef.current;
          const curFile = activeFileRef.current;
          if (!sol || !curFile) return null;

          const wordInfo = model.getWordAtPosition(position);
          const { targets } = resolveCSharpImplementations(
            sol,
            curFile,
            position.lineNumber,
            position.column,
            wordInfo?.word
          );
          if (targets.length === 0) return null;

          return targets.map(t => ({
            uri: makeTargetUri(monaco, t.file),
            range: new monaco.Range(t.line, t.column, t.line, t.column + Math.max(1, (wordInfo?.word || t.name).length))
          }));
        }
      });

      monaco.languages.registerCompletionItemProvider('csharp', {
        triggerCharacters: ['.'],
        provideCompletionItems: (model: any, position: any) => {
          const sol = solutionRef.current;
          const curFile = activeFileRef.current;
          if (!sol || !curFile) return { suggestions: [] };

          const word = model.getWordUntilPosition(position);
          const range = new monaco.Range(
            position.lineNumber,
            word.startColumn,
            position.lineNumber,
            word.endColumn
          );

          const entries = getCSharpCompletions(sol, curFile, position.lineNumber, position.column);
          const kindMap: Record<string, any> = {
            method: monaco.languages.CompletionItemKind.Method,
            property: monaco.languages.CompletionItemKind.Property,
            field: monaco.languages.CompletionItemKind.Field,
            class: monaco.languages.CompletionItemKind.Class,
            interface: monaco.languages.CompletionItemKind.Interface
          };

          return {
            suggestions: entries.map(e => ({
              label: e.label,
              kind: kindMap[e.kind] || monaco.languages.CompletionItemKind.Text,
              detail: e.detail,
              documentation: e.documentation,
              insertText: e.insertText,
              range
            }))
          };
        }
      });

      monaco.languages.registerHoverProvider('csharp', {
        provideHover: (model: any, position: any) => {
          const sol = solutionRef.current;
          const curFile = activeFileRef.current;
          if (!sol || !curFile) return null;

          // Suppress static hover tooltip if the interactive Debug Value Card handles this expression
          if (isDebuggingPausedRef.current) {
            const lineTxt = model.getLineContent(position.lineNumber) || '';
            const exprCandidate = extractCSharpExpressionAtPosition(lineTxt, position.column);
            if (exprCandidate) {
              return null;
            }
          }

          const wordInfo = model.getWordAtPosition(position);
          if (!wordInfo?.word) return null;

          const info = getCSharpHoverInfo(
            sol,
            curFile,
            position.lineNumber,
            position.column,
            wordInfo.word
          );
          if (!info) return null;

          return {
            range: new monaco.Range(position.lineNumber, wordInfo.startColumn, position.lineNumber, wordInfo.endColumn),
            contents: [
              { value: `\`\`\`csharp\n${info.title}\n\`\`\`` },
              { value: `**${info.subtitle}**` },
              ...info.details.map(d => ({ value: d }))
            ]
          };
        }
      });

      monaco.editor.registerEditorOpener({
        openCodeEditor: (_source: any, resource: any, selectionOrPosition: any) => {
          const mappedPath = uriPathMap.get(resource?.toString()) || resource?.path;
          if (!mappedPath) return false;
          const line = selectionOrPosition?.startLineNumber || selectionOrPosition?.lineNumber || 1;
          const col = selectionOrPosition?.startColumn || selectionOrPosition?.column || 1;
          callbacksRef.current.onNavigateToFileLocation?.(mappedPath, line, col);
          return true;
        }
      });
    }

    // Track cursor position for Status Bar and Back/Forward history
    editor.onDidChangeCursorPosition((e: any) => {
      setCursorPos({ line: e.position.lineNumber, column: e.position.column });
      callbacksRef.current.onCursorPositionChange?.(e.position.lineNumber, e.position.column);
    });

    // Apply pending jump right after @monaco-editor/react finishes swapping the model on file switch
    editor.onDidChangeModel(() => {
      const pending = pendingJumpRef.current;
      const cur = activeFileRef.current;
      if (!pending || !cur) return;
      const norm = (p: string) => p.replace(/\\/g, '/').toLowerCase();
      if (norm(cur.path) !== norm(pending.filePath)) return;

      const applyJump = () => {
        const model = editor.getModel();
        if (!model) return;
        const maxLine = Math.max(1, model.getLineCount());
        const targetLine = Math.min(Math.max(1, pending.line), maxLine);
        const targetCol = Math.max(1, pending.column || 1);
        editor.revealLineInCenter(targetLine);
        editor.setPosition({ lineNumber: targetLine, column: targetCol });
        editor.focus();
        highlightCollectionRef.current?.clear();
        highlightCollectionRef.current = editor.createDecorationsCollection([
          {
            range: new monaco.Range(targetLine, 1, targetLine, 1),
            options: {
              isWholeLine: true,
              className: 'bg-indigo-500/25 border-l-4 border-indigo-400'
            }
          }
        ]);
        setTimeout(() => {
          highlightCollectionRef.current?.clear();
        }, 1600);
        pendingJumpRef.current = null;
      };

      requestAnimationFrame(() => {
        setTimeout(applyJump, 25);
      });
    });

    // Register click listener for breakpoints and Cmd+Click / Ctrl+Click definition navigation
    editor.onMouseDown((e: any) => {
      const currentFile = activeFileRef.current;
      if (!currentFile) return;

      // 1. Breakpoint gutter click
      if (
        e.target.type === monaco.editor.MouseTargetType.GUTTER_GLYPH_MARGIN ||
        e.target.type === monaco.editor.MouseTargetType.GUTTER_LINE_NUMBERS
      ) {
        const line = e.target.position?.lineNumber;
        if (line) {
          callbacksRef.current.onToggleBreakpoint(currentFile.path, line);
        }
        return;
      }

      // 2. Cmd + Click (macOS) or Control + Left Click -> Go to Definition / Symbol
      const isLeftClick = e.event.leftButton || e.event.browserEvent?.button === 0;
      if ((e.event.metaKey || e.event.ctrlKey) && isLeftClick && e.target.position) {
        const pos = e.target.position;
        const model = editor.getModel();
        const word = model?.getWordAtPosition(pos);
        if (word && word.word) {
          if (e.event.ctrlKey) {
            // Suppress macOS Control+Click default context menu popup
            suppressNextContextMenuRef.current = true;
            setTimeout(() => {
              suppressNextContextMenuRef.current = false;
            }, 300);
          }
          e.event.preventDefault();
          e.event.stopPropagation();
          callbacksRef.current.onGoToDefinition(currentFile, pos.lineNumber, pos.column, word.word);
        }
      }
    });

    const showEvaluatedCardAt = async (expr: string, pos: { lineNumber: number; column: number }) => {
      if (!isDebuggingPausedRef.current || !callbacksRef.current.onEvaluateDebugExpression) return;
      const evalRes = await callbacksRef.current.onEvaluateDebugExpression(expr, 'hover');
      if (!evalRes || !evalRes.success || evalRes.result === '') return;

      const coords = editor.getScrolledVisiblePosition(pos);
      if (!coords) return;

      const containerW = editorContainerRef.current?.clientWidth || 720;
      const cardLeft = Math.max(12, Math.min(coords.left + 8, containerW - 350));
      const cardTop = Math.max(8, coords.top + (coords.height || 20) + 4);

      isEditingHoverValueRef.current = false;
      setIsHoverSettingValue(false);
      setHoverExpandedRefs({});
      setHoverNewValue(evalRes.result);
      setDebugHoverCard({
        expression: expr,
        result: evalRes.result,
        type: evalRes.type,
        variablesReference: evalRes.variablesReference,
        children: evalRes.children,
        top: cardTop,
        left: cardLeft,
        lineNumber: pos.lineNumber
      });
    };

    // Hover over any variable/expression or selection during debug pause -> show live runtime value
    editor.onMouseMove((e: any) => {
      if (!isDebuggingPausedRef.current) return;
      if (isPointerInHoverCardRef.current || isEditingHoverValueRef.current) return;

      if (hoverTimerRef.current) {
        window.clearTimeout(hoverTimerRef.current);
        hoverTimerRef.current = null;
      }

      const pos = e.target?.position;
      const targetType = e.target?.type;
      const isTextHover =
        targetType === monaco.editor.MouseTargetType.CONTENT_TEXT ||
        targetType === monaco.editor.MouseTargetType.CONTENT_EMPTY;

      if (!pos || !isTextHover) {
        if (!hideHoverTimerRef.current) {
          hideHoverTimerRef.current = window.setTimeout(() => {
            if (!isPointerInHoverCardRef.current && !isEditingHoverValueRef.current) {
              setDebugHoverCard(null);
            }
            hideHoverTimerRef.current = null;
          }, 260);
        }
        return;
      }

      const model = editor.getModel();
      if (!model) return;

      const sel = editor.getSelection();
      let selectedText = '';
      if (sel && !sel.isEmpty()) {
        const contains =
          sel.containsPosition(pos) ||
          (pos.lineNumber >= sel.startLineNumber &&
            pos.lineNumber <= sel.endLineNumber &&
            Math.abs(pos.column - sel.endColumn) <= 3);
        if (contains) {
          selectedText = model.getValueInRange(sel);
        }
      }

      const lineContent = model.getLineContent(pos.lineNumber) || '';
      const expr = extractCSharpExpressionAtPosition(lineContent, pos.column, selectedText);

      if (!expr) {
        if (!hideHoverTimerRef.current) {
          hideHoverTimerRef.current = window.setTimeout(() => {
            if (!isPointerInHoverCardRef.current && !isEditingHoverValueRef.current) {
              setDebugHoverCard(null);
            }
            hideHoverTimerRef.current = null;
          }, 220);
        }
        return;
      }

      if (hideHoverTimerRef.current) {
        window.clearTimeout(hideHoverTimerRef.current);
        hideHoverTimerRef.current = null;
      }

      if (
        debugHoverExprRef.current &&
        debugHoverExprRef.current.expr === expr &&
        debugHoverExprRef.current.lineNumber === pos.lineNumber
      ) {
        return;
      }

      hoverTimerRef.current = window.setTimeout(() => {
        showEvaluatedCardAt(expr, pos);
      }, 170);
    });

    // Selecting an expression in debug mode also evaluates & displays value directly over selection
    editor.onDidChangeCursorSelection((e: any) => {
      if (!isDebuggingPausedRef.current) return;
      if (isEditingHoverValueRef.current) return;
      const sel = e.selection;
      if (!sel || sel.isEmpty()) return;
      const model = editor.getModel();
      if (!model) return;
      const rawSelected = model.getValueInRange(sel).trim();
      if (!rawSelected || rawSelected.includes('\n') || rawSelected.length > 160) return;

      if (hoverTimerRef.current) {
        window.clearTimeout(hoverTimerRef.current);
      }
      hoverTimerRef.current = window.setTimeout(() => {
        showEvaluatedCardAt(rawSelected, sel.getStartPosition());
      }, 220);
    });

    // Intercept right-click to show our authentic JetBrains Rider + Debug Runtime context menu
    editor.onContextMenu((e: any) => {
      e.event.preventDefault();
      e.event.stopPropagation();
      if (suppressNextContextMenuRef.current) {
        suppressNextContextMenuRef.current = false;
        return;
      }

      const model = editor.getModel();
      const pos = e.target?.position || editor.getPosition() || { lineNumber: 1, column: 1 };
      const sel = editor.getSelection();
      let selectedText = '';
      if (sel && !sel.isEmpty() && model) {
        selectedText = model.getValueInRange(sel).trim();
      }
      const lineTxt = model ? model.getLineContent(pos.lineNumber) || '' : '';
      const debugExpr = isDebuggingPausedRef.current
        ? extractCSharpExpressionAtPosition(lineTxt, pos.column, selectedText)
        : null;

      setContextMenuState({
        x: e.event.posx,
        y: e.event.posy,
        debugExpression: debugExpr,
        debugPreviewValue: null,
        cursorLine: pos.lineNumber
      });

      if (isDebuggingPausedRef.current && debugExpr && callbacksRef.current.onEvaluateDebugExpression) {
        callbacksRef.current.onEvaluateDebugExpression(debugExpr, 'hover').then((res) => {
          if (res && res.success) {
            setContextMenuState(prev =>
              prev && prev.debugExpression === debugExpr
                ? { ...prev, debugPreviewValue: res.result }
                : prev
            );
          }
        }).catch(() => {});
      }
    });

    // Action: Evaluate Expression (⌥F8)
    editor.addAction({
      id: 'sharpforge.evaluateExpression',
      label: 'Evaluate Expression... (⌥F8)',
      keybindings: [monaco.KeyMod.Alt | monaco.KeyCode.F8],
      run: (ed: any) => {
        if (!isDebuggingPausedRef.current) return;
        const model = ed.getModel();
        const pos = ed.getPosition();
        const sel = ed.getSelection();
        const selTxt = sel && !sel.isEmpty() && model ? model.getValueInRange(sel).trim() : '';
        const lineTxt = pos && model ? model.getLineContent(pos.lineNumber) || '' : '';
        const expr =
          pos
            ? extractCSharpExpressionAtPosition(lineTxt, pos.column, selTxt) || ''
            : selTxt;
        callbacksRef.current.onOpenEvaluateModal?.(expr, 'evaluate');
      }
    });

    // Action: Save File (⌘S)
    editor.addAction({
      id: 'sharpforge.saveFile',
      label: 'Save File (⌘S)',
      keybindings: [monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS],
      run: () => {
        const currentFile = activeFileRef.current;
        if (currentFile) {
          callbacksRef.current.onSaveFile?.(currentFile);
        }
      }
    });

    // Action: Go to Implementation (⌥⌘B or Cmd+F12)
    editor.addAction({
      id: 'sharpforge.goToImplementation',
      label: 'Go to Implementation (⌥⌘B)',
      keybindings: [
        monaco.KeyMod.Alt | monaco.KeyMod.WinCtrl | monaco.KeyCode.KeyB,
        monaco.KeyMod.CtrlCmd | monaco.KeyCode.F12
      ],
      contextMenuGroupId: 'navigation',
      contextMenuOrder: 1.1,
      run: (ed: any) => {
        const currentFile = activeFileRef.current;
        const pos = ed.getPosition();
        const model = ed.getModel();
        const word = pos ? model?.getWordAtPosition(pos)?.word : undefined;
        if (pos && currentFile) {
          callbacksRef.current.onGoToImplementation(currentFile, pos.lineNumber, pos.column, word);
        }
      }
    });

    // Action: Go to Definition (⌘B or F12)
    editor.addAction({
      id: 'sharpforge.goToDefinition',
      label: 'Declaration or Usages (⌘B)',
      keybindings: [monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyB, monaco.KeyCode.F12],
      contextMenuGroupId: 'navigation',
      contextMenuOrder: 1.2,
      run: (ed: any) => {
        const currentFile = activeFileRef.current;
        const pos = ed.getPosition();
        const model = ed.getModel();
        const word = pos ? model?.getWordAtPosition(pos)?.word : undefined;
        if (pos && currentFile) {
          callbacksRef.current.onGoToDefinition(currentFile, pos.lineNumber, pos.column, word);
        }
      }
    });

    // Action: Find Usages (⌥F7 or Shift+F12)
    editor.addAction({
      id: 'sharpforge.findReferences',
      label: 'Find Usages (⌥F7)',
      keybindings: [monaco.KeyMod.Alt | monaco.KeyCode.F7, monaco.KeyMod.Shift | monaco.KeyCode.F12],
      contextMenuGroupId: 'navigation',
      contextMenuOrder: 1.3,
      run: (ed: any) => {
        const currentFile = activeFileRef.current;
        const pos = ed.getPosition();
        const model = ed.getModel();
        const word = pos ? model?.getWordAtPosition(pos)?.word : undefined;
        if (pos && currentFile) {
          callbacksRef.current.onFindReferences(currentFile, pos.lineNumber, pos.column, word);
        }
      }
    });
  };

  // Jump to specific line & column and flash pulse highlight when navigating
  useEffect(() => {
    if (!activeFile || !activeLine) return;
    pendingJumpRef.current = {
      filePath: activeFile.path,
      line: activeLine,
      column: activeColumn || 1
    };

    if (!editorRef.current || !monacoRef.current) return;
    const editor = editorRef.current;
    const monaco = monacoRef.current;
    const norm = (p: string) => p.replace(/\\/g, '/').toLowerCase();

    let cancelled = false;
    const performJump = (attempt = 0) => {
      if (cancelled) return;
      const model = editor.getModel();
      if (!model) return;
      const modelPath = norm(model.uri?.path || '');
      const targetPath = norm(activeFile.path);
      if (modelPath && targetPath && !modelPath.endsWith(targetPath) && !targetPath.endsWith(modelPath)) {
        if (attempt < 6) {
          setTimeout(() => performJump(attempt + 1), 60);
        }
        return;
      }

      const maxLine = Math.max(1, model.getLineCount());
      const safeLine = Math.min(Math.max(1, activeLine), maxLine);
      const safeCol = Math.max(1, activeColumn || 1);

      editor.revealLineInCenter(safeLine);
      editor.setPosition({ lineNumber: safeLine, column: safeCol });
      editor.focus();

      highlightCollectionRef.current?.clear();
      highlightCollectionRef.current = editor.createDecorationsCollection([
        {
          range: new monaco.Range(safeLine, 1, safeLine, 1),
          options: {
            isWholeLine: true,
            className: 'bg-indigo-500/25 border-l-4 border-indigo-400'
          }
        }
      ]);
      setTimeout(() => {
        highlightCollectionRef.current?.clear();
      }, 1600);
      pendingJumpRef.current = null;
    };

    const timer = setTimeout(() => performJump(0), 75);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [activeFile?.id, activeFile?.path, activeLine, activeColumn, navigationNonce]);

  // Register & sync custom themes + active theme dynamically
  useEffect(() => {
    if (!monacoRef.current) return;
    for (const ct of customThemes) {
      try {
        monacoRef.current.editor.defineTheme(ct.id, {
          base: ct.uiTheme === 'vs' ? 'vs' : 'vs-dark',
          inherit: true,
          rules: (ct.rules || []).map(r => ({
            token: r.token,
            foreground: r.foreground,
            fontStyle: r.fontStyle
          })),
          colors: ct.colors || {}
        });
      } catch {}
    }
    try {
      monacoRef.current.editor.setTheme(editorTheme);
    } catch {}
  }, [editorTheme, customThemes]);

  // Clear floating debug inspection popup whenever execution resumes or stops
  useEffect(() => {
    if (!isDebuggingPaused) {
      setDebugHoverCard(null);
      setIsHoverSettingValue(false);
      isEditingHoverValueRef.current = false;
      isPointerInHoverCardRef.current = false;
    }
  }, [isDebuggingPaused]);

  // Update Breakpoints & Paused Line Decorations
  useEffect(() => {
    if (!editorRef.current || !monacoRef.current || !activeFile) return;

    const monaco = monacoRef.current;
    const editor = editorRef.current;
    const model = editor.getModel();
    const maxLine = model ? Math.max(1, model.getLineCount()) : 100000;

    const norm = (p: string) => p.replace(/\\/g, '/').toLowerCase();
    const activeNorm = norm(activeFile.path);
    const activeRelNorm = norm(activeFile.relativePath || activeFile.name);
    const matchesActive = (candidate: string) => {
      if (!candidate) return false;
      const c = norm(candidate);
      return c === activeNorm || activeNorm.endsWith('/' + c) || c.endsWith('/' + activeRelNorm);
    };

    const fileBreakpoints = breakpoints.filter(b => matchesActive(b.filePath));
    const isPausedInThisFile = pausedLocation && matchesActive(pausedLocation.filePath);

    const newDecorations: any[] = [];

    fileBreakpoints.forEach(bp => {
      const safeLine = Math.min(Math.max(1, bp.line), maxLine);
      newDecorations.push({
        range: new monaco.Range(safeLine, 1, safeLine, 1),
        options: {
          isWholeLine: true,
          className: bp.enabled ? 'sharpforge-breakpoint-line' : '',
          glyphMarginClassName: bp.enabled ? 'sharpforge-breakpoint-glyph' : 'sharpforge-breakpoint-disabled-glyph',
          glyphMarginHoverMessage: { value: `Breakpoint at line ${safeLine} (${bp.enabled ? 'Enabled' : 'Disabled'})` }
        }
      });
    });

    if (isPausedInThisFile && pausedLocation) {
      const safeLine = Math.min(Math.max(1, pausedLocation.line), maxLine);
      newDecorations.push({
        range: new monaco.Range(safeLine, 1, safeLine, 1),
        options: {
          isWholeLine: true,
          className: 'sharpforge-paused-line',
          glyphMarginClassName: 'sharpforge-paused-glyph'
        }
      });
      editor.revealLineInCenter(safeLine);
    }

    const fileDiags = diagnostics.filter(d => matchesActive(d.file));
    fileDiags.forEach(d => {
      const safeLine = Math.min(Math.max(1, d.line), maxLine);
      const safeCol = Math.max(1, d.column || 1);
      newDecorations.push({
        range: new monaco.Range(safeLine, safeCol, safeLine, safeCol + 15),
        options: {
          inlineClassName: d.severity === 'error' ? 'squiggly-error' : 'squiggly-warning',
          hoverMessage: { value: `**${d.code}** [${d.source}]: ${d.message}` }
        }
      });
    });

    decorationsRef.current = editor.deltaDecorations(decorationsRef.current, newDecorations);
  }, [breakpoints, pausedLocation, activeFile, diagnostics]);

  const getLanguage = (ext: string) => {
    switch (ext) {
      case '.cs': return 'csharp';
      case '.json': return 'json';
      case '.xml':
      case '.csproj':
      case '.fsproj':
      case '.props':
      case '.targets':
      case '.slnx': return 'xml';
      case '.md': return 'markdown';
      case '.yml':
      case '.yaml': return 'yaml';
      default: return 'plaintext';
    }
  };

  const isAppSettings = activeFile?.name.toLowerCase().includes('appsettings');
  const isDirty = activeFile ? dirtyFileIds?.has(activeFile.id) : false;

  return (
    <div className="flex-1 flex flex-col min-h-0 h-full bg-[#1e1f22] overflow-hidden relative">
      {/* Editor Tabs Bar */}
      <div className="h-9 min-h-[36px] shrink-0 bg-[#26282b] border-b border-[#1e1f22] flex items-center justify-between select-none px-1 space-x-1 relative z-20">
        <div
          ref={tabsScrollRef}
          onWheel={(e) => {
            if (tabsScrollRef.current && Math.abs(e.deltaY) > Math.abs(e.deltaX)) {
              tabsScrollRef.current.scrollLeft += e.deltaY;
            }
          }}
          className="flex items-center space-x-0.5 overflow-x-auto flex-1 min-w-0 py-0.5"
        >
          {openFiles.length === 0 ? (
            <div className="px-3 text-xs text-[#868a91] italic">No files open</div>
          ) : (
            openFiles.map(file => {
              const isActive = activeFile?.id === file.id;
              const isFileAppSettings = file.name.toLowerCase().includes('appsettings');
              const isFileDirty = dirtyFileIds?.has(file.id);

              return (
                <div
                  key={file.id}
                  onClick={() => onSelectFile(file)}
                  onMouseDown={(e) => {
                    if (e.button === 1) {
                      e.preventDefault();
                      onCloseFile(file);
                    }
                  }}
                  title={file.path}
                  className={`group flex items-center space-x-1.5 px-2.5 py-1 text-xs rounded-t border-t-2 cursor-pointer transition max-w-[230px] shrink-0 ${
                    isActive
                      ? 'bg-[#1e1f22] text-[#dfe1e5] border-[#3574f0] font-medium'
                      : 'bg-[#2b2d30]/75 text-[#9aa0a6] border-transparent hover:bg-[#2b2d30] hover:text-[#dfe1e5]'
                  }`}
                >
                  <span className="truncate">{file.name}</span>
                  {file.isDecompiled && (
                    <span className="text-[9px] bg-sky-500/20 text-sky-300 px-1 rounded font-mono shrink-0">
                      IL
                    </span>
                  )}
                  {isFileDirty && (
                    <span className="w-1.5 h-1.5 rounded-full bg-amber-400 shrink-0" title="Unsaved changes (⌘S)" />
                  )}
                  {isFileAppSettings && (
                    <span className="text-[9px] bg-amber-500/20 text-amber-300 px-1 rounded font-mono shrink-0">
                      env
                    </span>
                  )}
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      onCloseFile(file);
                    }}
                    className={`${
                      isActive ? 'opacity-80' : 'opacity-50 group-hover:opacity-100'
                    } hover:bg-[#35373c] p-0.5 rounded text-[#868a91] hover:text-white transition shrink-0`}
                    title="Close (Cmd+W)"
                  >
                    <X className="w-3 h-3" />
                  </button>
                </div>
              );
            })
          )}
        </div>

        <div className="flex items-center space-x-1.5 mr-1 shrink-0 relative">
          {openFiles.length > 0 && (
            <button
              type="button"
              onClick={() => setIsTabsDropdownOpen(prev => !prev)}
              className="flex items-center space-x-1 px-1.5 py-0.5 rounded bg-[#1e1f22] hover:bg-[#35373c] border border-[#393b40] text-[10px] text-[#bcbec4]"
              title="Show all opened tabs"
            >
              <Files className="w-3 h-3 text-sky-400" />
              <span>{openFiles.length}</span>
            </button>
          )}
          {isTabsDropdownOpen && (
            <div
              className="fixed inset-0 z-40"
              onClick={() => setIsTabsDropdownOpen(false)}
            >
              <div
                onClick={(e) => e.stopPropagation()}
                className="absolute right-4 top-20 w-72 max-h-80 overflow-y-auto bg-[#26282b] border border-[#393b40] rounded-lg shadow-2xl py-1 z-50"
              >
                <div className="px-3 py-1 text-[10px] uppercase font-bold text-gray-400 border-b border-[#393b40]">
                  Open Editor Tabs ({openFiles.length})
                </div>
                {openFiles.map(f => (
                  <div
                    key={f.id}
                    onClick={() => {
                      onSelectFile(f);
                      setIsTabsDropdownOpen(false);
                    }}
                    className={`px-3 py-1.5 flex items-center justify-between cursor-pointer text-xs ${
                      activeFile?.id === f.id ? 'bg-[#3574f0] text-white' : 'text-[#dfe1e5] hover:bg-[#2b2d30]'
                    }`}
                  >
                    <span className="truncate font-mono">{f.name}</span>
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        onCloseFile(f);
                      }}
                      className="p-0.5 hover:bg-black/20 rounded"
                    >
                      <X className="w-3 h-3" />
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}

          {isDirty && activeFile && !activeFile.isReadOnly && onSaveFile && (
            <button
              onClick={() => onSaveFile(activeFile)}
              className="flex items-center space-x-1 bg-emerald-500/15 hover:bg-emerald-500/25 text-emerald-300 border border-emerald-500/30 px-2 py-0.5 rounded text-[11px] font-medium transition shadow-sm"
              title="Save File (⌘S)"
            >
              <Save className="w-3 h-3" />
              <span>Save</span>
            </button>
          )}
          {isAppSettings && activeFile && onOpenAppSettingsEnv && (
            <button
              onClick={() => onOpenAppSettingsEnv(activeFile)}
              className="flex items-center space-x-1.5 bg-amber-500/15 hover:bg-amber-500/25 text-amber-300 border border-amber-500/30 px-2 py-0.5 rounded text-[11px] font-medium transition shadow-sm"
              title="Convert and Sync AppSettings to Environment Variables"
            >
              <FolderSync className="w-3.5 h-3.5" />
              <span>Set Env</span>
            </button>
          )}
        </div>
      </div>

      {/* Breadcrumbs & File Structure Symbol Jump Bar */}
      {activeFile && (
        <div className="h-6 bg-[#1e1f22] border-b border-[#2b2d30] px-3 flex items-center justify-between text-[11px] text-[#868a91] select-none shrink-0">
          <div className="flex items-center space-x-2 truncate font-mono">
            {onLocateInExplorer && !activeFile.isDecompiled && (
              <button
                type="button"
                onClick={onLocateInExplorer}
                className="p-0.5 rounded hover:bg-[#35373c] text-gray-400 hover:text-emerald-400 transition shrink-0"
                title="Select Opened File in Solution Explorer"
              >
                <LocateFixed className="w-3 h-3" />
              </button>
            )}
            <span className="text-[#bcbec4] truncate">{activeFile.relativePath || activeFile.name}</span>
            {activeFile.isDecompiled && (
              <span className="text-[10px] bg-sky-500/15 text-sky-300 border border-sky-500/30 px-1.5 rounded font-sans shrink-0">
                Decompiled · Read-Only
              </span>
            )}
          </div>
          {solution && activeFile.extension === '.cs' && (() => {
            const outline = getFileOutlineSymbols(solution, activeFile);
            if (outline.length === 0) return null;
            return (
              <div className="flex items-center space-x-1.5 shrink-0">
                <span className="text-[10px] text-gray-500">Structure:</span>
                <select
                  value=""
                  onChange={(e) => {
                    const lineNum = Number(e.target.value);
                    const sym = outline.find(s => s.line === lineNum);
                    if (sym && editorRef.current) {
                      editorRef.current.revealLineInCenter(sym.line);
                      editorRef.current.setPosition({ lineNumber: sym.line, column: sym.column });
                      editorRef.current.focus();
                    }
                  }}
                  className="bg-[#26282b] text-[#dfe1e5] border border-[#393b40] rounded px-1.5 py-0.5 text-[11px] focus:outline-none cursor-pointer max-w-[220px]"
                  title="Jump to class, interface, method, or property in current file"
                >
                  <option value="" disabled>
                    Jump to symbol ({outline.length})...
                  </option>
                  {outline.map((sym, i) => (
                    <option key={`${sym.line}-${i}`} value={sym.line}>
                      {sym.kind === 'class' || sym.kind === 'interface'
                        ? `[${sym.kind}] ${sym.name}`
                        : `  .${sym.name} :${sym.line}`}
                    </option>
                  ))}
                </select>
              </div>
            );
          })()}
        </div>
      )}

      {/* Editor Area */}
      <div
        ref={editorContainerRef}
        className="flex-1 relative min-h-0"
        onMouseLeave={() => {
          if (!isPointerInHoverCardRef.current && !isEditingHoverValueRef.current) {
            setDebugHoverCard(null);
          }
        }}
      >
        {activeFile ? (
          <Editor
            height="100%"
            path={activeFile.path}
            language={getLanguage(activeFile.extension)}
            theme={editorTheme}
            value={activeFile.content || ''}
            onChange={(val) => {
              if (!activeFile.isReadOnly) {
                onContentChange(activeFile, val || '');
              }
            }}
            onMount={handleEditorDidMount}
            options={{
              readOnly: Boolean(activeFile.isReadOnly),
              fontSize: 13,
              lineHeight: 20,
              fontFamily: "'JetBrains Mono', 'Fira Code', Menlo, Monaco, Consolas, monospace",
              fontLigatures: true,
              'semanticHighlighting.enabled': true,
              stickyScroll: { enabled: true },
              guides: { bracketPairs: true, indentation: true },
              occurrencesHighlight: 'singleFile',
              cursorBlinking: 'smooth',
              smoothScrolling: true,
              minimap: { enabled: true, maxColumn: 80 },
              scrollBeyondLastLine: false,
              glyphMargin: true,
              lineNumbers: 'on',
              lineNumbersMinChars: 3,
              renderLineHighlight: 'all',
              tabSize: 4,
              insertSpaces: true,
              automaticLayout: true,
              bracketPairColorization: { enabled: true },
              suggestOnTriggerCharacters: true,
              quickSuggestions: true,
              parameterHints: { enabled: true },
              folding: true,
              wordWrap: 'off',
              multiCursorModifier: 'alt',
              contextmenu: false
            }}
          />
        ) : (
          <div className="flex flex-col items-center justify-center h-full text-slate-500 space-y-3">
            <img src="./icon.png" alt="SharpForge" className="w-12 h-12 rounded-2xl shadow-lg object-cover" />
            <div className="text-sm font-medium text-slate-400">SharpForge C#/.NET IDE</div>
            <div className="text-xs text-slate-500 space-y-1 text-center font-mono">
              <p>⌘Click / Ctrl+Click — Go to Symbol</p>
              <p>⌥⌘B — Go to Implementation</p>
              <p>⌘B / F12 — Declaration or Usages</p>
              <p>⌥⌘← / ⌥⌘→ — Navigate Back / Forward</p>
              <p>⌥F7 — Find Usages · ⌥F8 — Evaluate in Debug</p>
              <p>⌘P — Quick Open File</p>
              <p>F5 — Start / Continue Debugging</p>
            </div>
          </div>
        )}

        {/* Interactive Debug Value Hover / Selection Card */}
        {isDebuggingPaused && debugHoverCard && (
          <div
            style={{ top: debugHoverCard.top, left: debugHoverCard.left }}
            onMouseEnter={() => {
              isPointerInHoverCardRef.current = true;
              if (hideHoverTimerRef.current) {
                window.clearTimeout(hideHoverTimerRef.current);
                hideHoverTimerRef.current = null;
              }
            }}
            onMouseLeave={() => {
              isPointerInHoverCardRef.current = false;
              if (!isEditingHoverValueRef.current) {
                hideHoverTimerRef.current = window.setTimeout(() => {
                  setDebugHoverCard(null);
                  hideHoverTimerRef.current = null;
                }, 220);
              }
            }}
            className="absolute z-40 w-[340px] max-w-[90vw] bg-[#26282b] border border-purple-500/50 rounded-lg shadow-2xl text-xs text-[#dfe1e5] select-none overflow-hidden animate-in fade-in duration-100"
          >
            {/* Header */}
            <div className="px-2.5 py-1.5 bg-[#212327] border-b border-[#393b40] flex items-center justify-between gap-2">
              <div className="flex items-center space-x-1.5 min-w-0 font-mono">
                <span className="text-sky-300 font-semibold truncate">{debugHoverCard.expression}</span>
                {debugHoverCard.type && (
                  <span className="text-[10px] bg-[#2b2d30] text-gray-400 px-1.5 py-0.5 rounded shrink-0">
                    {debugHoverCard.type}
                  </span>
                )}
              </div>
              <button
                type="button"
                onClick={() => {
                  isEditingHoverValueRef.current = false;
                  setIsHoverSettingValue(false);
                  setDebugHoverCard(null);
                }}
                className="p-0.5 text-gray-400 hover:text-white rounded shrink-0"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>

            {/* Live Value + Expandable Object Members */}
            <div className="px-2.5 py-2 font-mono text-[11px] max-h-48 overflow-y-auto space-y-1 bg-[#1e1f22]">
              <div className="flex items-start justify-between gap-2">
                <div className="flex items-center space-x-1.5 min-w-0">
                  {((debugHoverCard.variablesReference && debugHoverCard.variablesReference > 0) ||
                    (debugHoverCard.children && debugHoverCard.children.length > 0)) && (
                    <button
                      type="button"
                      onClick={async () => {
                        const refId = debugHoverCard.variablesReference || 0;
                        if (refId > 0 && onExpandDebugVariables) {
                          if (hoverExpandedRefs[refId]) {
                            const next = { ...hoverExpandedRefs };
                            delete next[refId];
                            setHoverExpandedRefs(next);
                          } else {
                            const children = await onExpandDebugVariables(refId);
                            setHoverExpandedRefs(prev => ({ ...prev, [refId]: children }));
                          }
                        }
                      }}
                      className="text-gray-400 hover:text-white shrink-0"
                    >
                      {debugHoverCard.variablesReference && hoverExpandedRefs[debugHoverCard.variablesReference] ? (
                        <ChevronDown className="w-3.5 h-3.5" />
                      ) : (
                        <ChevronRight className="w-3.5 h-3.5" />
                      )}
                    </button>
                  )}
                  <span className="text-emerald-400 font-semibold break-all">{debugHoverCard.result}</span>
                </div>

                <button
                  type="button"
                  onClick={() => {
                    navigator.clipboard?.writeText(debugHoverCard.result);
                    setHoverCopied(true);
                    setTimeout(() => setHoverCopied(false), 1200);
                  }}
                  className="p-0.5 text-gray-400 hover:text-white rounded shrink-0"
                  title="Copy Runtime Value"
                >
                  {hoverCopied ? <Check className="w-3 h-3 text-emerald-400" /> : <Copy className="w-3 h-3" />}
                </button>
              </div>

              {(debugHoverCard.children ||
                (debugHoverCard.variablesReference ? hoverExpandedRefs[debugHoverCard.variablesReference] : undefined))?.map(
                (child, idx) => (
                  <div
                    key={`${child.name}-${idx}`}
                    className="pl-4 flex items-center space-x-1.5 py-0.5 border-l border-[#393b40]"
                  >
                    <span className="text-[#c77dbb] font-semibold shrink-0">{child.name}</span>
                    <span className="text-gray-500">=</span>
                    <span className="text-[#6aab73] truncate">{child.value}</span>
                    <span className="text-[10px] text-gray-500 shrink-0">({child.type})</span>
                  </div>
                )
              )}

              {/* Inline Runtime Set Value Form */}
              {isHoverSettingValue && (
                <form
                  onSubmit={async (e) => {
                    e.preventDefault();
                    if (!onSetDebugVariableValue) return;
                    const res = await onSetDebugVariableValue({
                      expression: debugHoverCard.expression,
                      newValue: hoverNewValue
                    });
                    isEditingHoverValueRef.current = false;
                    if (res.success) {
                      setIsHoverSettingValue(false);
                      setDebugHoverCard(prev =>
                        prev ? { ...prev, result: res.value ?? hoverNewValue } : null
                      );
                    }
                  }}
                  className="pt-1.5 flex items-center space-x-1.5 font-sans"
                >
                  <input
                    type="text"
                    autoFocus
                    value={hoverNewValue}
                    onFocus={() => {
                      isEditingHoverValueRef.current = true;
                    }}
                    onChange={(e) => setHoverNewValue(e.target.value)}
                    placeholder="New value..."
                    className="flex-1 bg-[#26282b] border border-amber-500/50 rounded px-2 py-1 text-white font-mono text-[11px] focus:outline-none focus:border-amber-400"
                  />
                  <button
                    type="submit"
                    className="bg-amber-500 hover:bg-amber-400 text-black font-semibold px-2 py-1 rounded text-[11px] transition shrink-0"
                  >
                    Set
                  </button>
                </form>
              )}
            </div>

            {/* Action Toolbar inside Hover Card */}
            <div className="px-2 py-1.5 bg-[#212327] border-t border-[#393b40] flex items-center justify-between text-[11px]">
              <div className="flex items-center space-x-1">
                <button
                  type="button"
                  onClick={() => {
                    onOpenEvaluateModal?.(debugHoverCard.expression, 'evaluate');
                    setDebugHoverCard(null);
                  }}
                  className="flex items-center space-x-1 px-2 py-0.5 rounded bg-[#2b2d30] hover:bg-[#3574f0] hover:text-white text-purple-300 transition"
                >
                  <Sparkles className="w-3 h-3" />
                  <span>Evaluate</span>
                </button>
                <button
                  type="button"
                  onClick={() => {
                    onAddWatchExpression?.(debugHoverCard.expression);
                  }}
                  className="flex items-center space-x-1 px-2 py-0.5 rounded bg-[#2b2d30] hover:bg-[#3574f0] hover:text-white text-sky-300 transition"
                >
                  <Eye className="w-3 h-3" />
                  <span>Watch</span>
                </button>
                <button
                  type="button"
                  onClick={() => {
                    isEditingHoverValueRef.current = true;
                    setHoverNewValue(debugHoverCard.result);
                    setIsHoverSettingValue(prev => !prev);
                  }}
                  className="flex items-center space-x-1 px-2 py-0.5 rounded bg-[#2b2d30] hover:bg-amber-500 hover:text-black text-amber-300 transition"
                >
                  <Pencil className="w-3 h-3" />
                  <span>Set Value</span>
                </button>
                <button
                  type="button"
                  onClick={async () => {
                    if (onCopyExpressionAsJson) {
                      onCopyExpressionAsJson(debugHoverCard.expression);
                    } else {
                      const jsonObj = await variablesToJsonObject(
                        {
                          result: debugHoverCard.result,
                          type: debugHoverCard.type,
                          variablesReference: debugHoverCard.variablesReference,
                          children: debugHoverCard.children
                        },
                        onExpandDebugVariables
                      );
                      navigator.clipboard?.writeText(JSON.stringify(jsonObj, null, 2));
                    }
                    setHoverCopied(true);
                    setTimeout(() => setHoverCopied(false), 1200);
                  }}
                  className="flex items-center space-x-1 px-2 py-0.5 rounded bg-[#2b2d30] hover:bg-emerald-600 hover:text-white text-emerald-300 transition"
                  title="Copy object serialized as JSON"
                >
                  <Braces className="w-3 h-3" />
                  <span>JSON</span>
                </button>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* SharpForge Context Menu */}
      {contextMenuState && (
        <EditorContextMenu
          x={contextMenuState.x}
          y={contextMenuState.y}
          onClose={() => setContextMenuState(null)}
          activeFile={activeFile}
          isDebuggingPaused={isDebuggingPaused}
          debugExpression={contextMenuState.debugExpression}
          debugPreviewValue={contextMenuState.debugPreviewValue}
          onEvaluateExpression={(expr) => {
            onOpenEvaluateModal?.(expr, 'evaluate');
          }}
          onAddWatchExpression={(expr) => {
            onAddWatchExpression?.(expr);
          }}
          onSetDebugValue={(expr) => {
            onOpenEvaluateModal?.(expr, 'setValue');
          }}
          onCopyAsJson={onCopyExpressionAsJson}
          onCopyAsCurl={onCopyAsCurl ? () => onCopyAsCurl(contextMenuState.cursorLine) : undefined}
          onToggleBreakpointAtCursor={() => {
            if (activeFile) {
              onToggleBreakpoint(activeFile.path, contextMenuState.cursorLine);
            }
          }}
          onGoToImplementation={() => {
            if (activeFile && editorRef.current) {
              const pos = editorRef.current.getPosition();
              const model = editorRef.current.getModel();
              const word = pos ? model?.getWordAtPosition(pos)?.word : undefined;
              onGoToImplementation(activeFile, pos?.lineNumber || 1, pos?.column || 1, word);
            }
          }}
          onGoToDefinition={() => {
            if (activeFile && editorRef.current) {
              const pos = editorRef.current.getPosition();
              const model = editorRef.current.getModel();
              const word = pos ? model?.getWordAtPosition(pos)?.word : undefined;
              onGoToDefinition(activeFile, pos?.lineNumber || 1, pos?.column || 1, word);
            }
          }}
          onFindUsages={() => {
            if (activeFile && editorRef.current) {
              const pos = editorRef.current.getPosition();
              const model = editorRef.current.getModel();
              const word = pos ? model?.getWordAtPosition(pos)?.word : undefined;
              onFindReferences(activeFile, pos?.lineNumber || 1, pos?.column || 1, word);
            }
          }}
          onOpenAppSettingsEnv={() => {
            if (activeFile && onOpenAppSettingsEnv) {
              onOpenAppSettingsEnv(activeFile);
            }
          }}
          onCut={() => {
            editorRef.current?.focus();
            document.execCommand('cut');
          }}
          onCopy={() => {
            editorRef.current?.focus();
            document.execCommand('copy');
          }}
          onPaste={() => {
            editorRef.current?.focus();
            navigator.clipboard.readText().then(text => {
              editorRef.current?.trigger('keyboard', 'type', { text });
            }).catch(() => {
              document.execCommand('paste');
            });
          }}
          onChangeAllOccurrences={() => {
            editorRef.current?.focus();
            editorRef.current?.trigger('contextmenu', 'editor.action.changeAll', null);
          }}
          onOpenCommandPalette={() => {
            editorRef.current?.focus();
            editorRef.current?.trigger('contextmenu', 'editor.action.quickCommand', null);
          }}
        />
      )}

      {/* Status Bar */}
      <footer className="h-6 shrink-0 bg-[#26282b] border-t border-[#1e1f22] px-3 flex items-center justify-between text-[11px] text-[#868a91] select-none font-mono tabular-nums">
        <div className="flex items-center space-x-3">
          {onToggleBottomPanel && (
            <button
              onClick={onToggleBottomPanel}
              className={`flex items-center space-x-1 px-1.5 py-0.5 rounded transition ${
                isBottomPanelOpen ? 'text-[#dfe1e5] bg-[#35373c]' : 'text-[#868a91] hover:text-[#dfe1e5]'
              }`}
              title="Toggle Bottom Tool Window (Terminal / Build / Problems)"
            >
              <PanelBottom className="w-3 h-3" />
              <span className="font-sans">Panel</span>
            </button>
          )}
          {solution && (
            <span className="text-[#868a91] hidden sm:inline">
              {solution.projects.length} proj · {getOrBuildSolutionIndex(solution).typesByName.size} types indexed
            </span>
          )}
          {activeFile && (
            <span>
              {activeFile.extension === '.cs' ? `C# · ${formatFrameworkLabel(targetFramework)}` : activeFile.extension.toUpperCase()}
            </span>
          )}
          {pausedLocation && (
            <span className="text-amber-300 bg-amber-500/15 px-1.5 rounded font-sans font-medium">
              Paused at line {pausedLocation.line}
            </span>
          )}
        </div>

        <div className="flex items-center space-x-3">
          {onChangeEditorTheme && (
            <button
              onClick={() => {
                const order: EditorThemeId[] = ['sharpforge-dark', 'vs-dark-plus', 'darcula'];
                const next = order[(order.indexOf(editorTheme) + 1) % order.length];
                onChangeEditorTheme(next);
              }}
              className="flex items-center space-x-1 hover:text-[#dfe1e5] transition"
              title="Switch Editor Color Theme (SharpForge Dark / VS Dark+ / Darcula)"
            >
              <Palette className="w-3 h-3 text-sky-400" />
              <span className="font-sans">
                {editorTheme === 'sharpforge-dark' || editorTheme === 'rider-dark'
                  ? 'SharpForge Dark'
                  : editorTheme === 'vs-dark-plus'
                  ? 'VS Dark+'
                  : 'Darcula'}
              </span>
            </button>
          )}
          {activeFile && (
            <span className="text-[#bcbec4]">
              Ln {cursorPos.line}, Col {cursorPos.column}
            </span>
          )}
          <span>UTF-8</span>
          <span>Spaces: 4</span>
          <span>macOS</span>
        </div>
      </footer>
    </div>
  );
};
