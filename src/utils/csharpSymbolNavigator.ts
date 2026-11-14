import {
  SolutionFile,
  SolutionFileItem,
  ProjectItem,
  ImplementationItem,
  ReferenceItem,
  TestItem
} from '../types/minirider';

export interface IndexedFile {
  file: SolutionFileItem;
  project: ProjectItem;
  lines: string[];
}

export interface ParsedParam {
  name: string;
  type: string;
  line: number;
  column: number;
}

export interface ParsedMember {
  name: string;
  kind: 'method' | 'property' | 'field' | 'ctor';
  returnType: string;
  explicitInterface?: string;
  params: ParsedParam[];
  isAbstract: boolean;
  isVirtual: boolean;
  isOverride: boolean;
  isStatic: boolean;
  isExtensionMethod: boolean;
  file: SolutionFileItem;
  project: ProjectItem;
  ownerTypeKey: string;
  ownerTypeName: string;
  ownerNamespace: string;
  ownerIsInterface: boolean;
  ownerIsAbstract: boolean;
  line: number;
  column: number;
  preview: string;
  bodyStartOffset?: number;
  bodyEndOffset?: number;
}

export interface ParsedType {
  key: string; // namespace.Name (or Name)
  name: string;
  genericArity: number;
  genericParams: string[];
  kind: 'class' | 'interface' | 'struct' | 'record' | 'enum';
  namespace: string;
  isInterface: boolean;
  isAbstract: boolean;
  isStatic: boolean;
  isPartial: boolean;
  baseTypes: string[]; // cleaned base type names (without generic args or ctor parens)
  rawBaseTypes: string[]; // full base types with generic args (e.g. IRequestHandler<CreateOrder, int>)
  primaryCtorParams: ParsedParam[];
  members: ParsedMember[];
  usings: string[];
  file: SolutionFileItem;
  project: ProjectItem;
  line: number;
  column: number;
  preview: string;
  bodyStartOffset: number;
  bodyEndOffset: number;
}

export interface DiBinding {
  serviceType: string;
  implType: string;
  file: SolutionFileItem;
  line: number;
}

export interface ParsedFileInfo {
  file: SolutionFileItem;
  project: ProjectItem;
  original: string;
  stripped: string;
  lineStarts: number[];
  lines: string[];
  usings: string[];
  usingAliases: Map<string, string>;
  types: ParsedType[];
}

export interface SolutionSemanticIndex {
  solutionKey: string;
  files: ParsedFileInfo[];
  typesByName: Map<string, ParsedType[]>;
  typesByKey: Map<string, ParsedType[]>;
  implementationsByBase: Map<string, ParsedType[]>;
  ancestorsByTypeKey: Map<string, Set<string>>;
  diBindingsByService: Map<string, DiBinding[]>;
  requestHandlerByRequest: Map<string, ParsedType[]>;
  projectDeps: Map<string, Set<string>>;
  allMethodsByName: Map<string, ParsedMember[]>;
}

export interface NavigationResult {
  symbolName: string;
  targets: ImplementationItem[];
}

// Cache semantic index by solution key + content fingerprint for instant repeat lookups
let cachedIndex: { fingerprint: string; index: SolutionSemanticIndex } | null = null;

/**
 * Flatten all non-directory files across all projects in the active solution.
 */
export function getAllSolutionFiles(solution: SolutionFile): IndexedFile[] {
  const result: IndexedFile[] = [];
  const seenFilePaths = new Set<string>();

  const walk = (items: SolutionFileItem[], project: ProjectItem) => {
    for (const item of items) {
      if (item.isDirectory && item.children) {
        walk(item.children, project);
      } else if (!item.isDirectory) {
        const norm = item.path.replace(/\\/g, '/');
        if (!seenFilePaths.has(norm)) {
          seenFilePaths.add(norm);
          result.push({
            file: item,
            project,
            lines: (item.content || '').split('\n')
          });
        }
      }
    }
  };

  for (const project of solution.projects) {
    walk(project.files, project);
  }

  return result;
}

/**
 * Compute lightweight fingerprint so edits invalidate the cached index automatically.
 */
function computeSolutionFingerprint(solution: SolutionFile, csFiles: IndexedFile[]): string {
  let lenSum = 0;
  for (let i = 0; i < csFiles.length; i++) {
    lenSum += (csFiles[i].file.content?.length || 0) * ((i % 7) + 1);
  }
  return `${solution.path}::${solution.projects.length}::${csFiles.length}::${lenSum}`;
}

/**
 * Build line start offsets for O(log N) offset -> (line, column) mapping.
 */
function buildLineStarts(text: string): number[] {
  const starts = [0];
  for (let i = 0; i < text.length; i++) {
    if (text.charCodeAt(i) === 10) {
      starts.push(i + 1);
    }
  }
  return starts;
}

function offsetToLineCol(lineStarts: number[], offset: number): { line: number; column: number } {
  const clamped = Math.max(0, offset);
  let lo = 0;
  let hi = lineStarts.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (lineStarts[mid] <= clamped) {
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  const lineIdx = Math.max(0, hi);
  return {
    line: lineIdx + 1,
    column: clamped - lineStarts[lineIdx] + 1
  };
}

function lineColToOffset(lineStarts: number[], line: number, column: number): number {
  const idx = Math.max(0, Math.min(lineStarts.length - 1, line - 1));
  return lineStarts[idx] + Math.max(0, column - 1);
}

/**
 * Strip C# comments, strings, char literals, and preprocessor lines while keeping exact character offsets & newlines intact.
 */
function stripCommentsAndStrings(src: string): string {
  const out = new Array<string>(src.length);
  const len = src.length;
  let i = 0;

  while (i < len) {
    const ch = src[i];
    const next = i + 1 < len ? src[i + 1] : '';

    // Preprocessor directive at line start (ignoring horizontal whitespace)
    if (ch === '#') {
      while (i < len && src[i] !== '\n') {
        out[i] = ' ';
        i++;
      }
      continue;
    }

    // Line comment //
    if (ch === '/' && next === '/') {
      while (i < len && src[i] !== '\n') {
        out[i] = ' ';
        i++;
      }
      continue;
    }

    // Block comment /* ... */
    if (ch === '/' && next === '*') {
      out[i] = ' ';
      out[i + 1] = ' ';
      i += 2;
      while (i < len) {
        if (src[i] === '*' && i + 1 < len && src[i + 1] === '/') {
          out[i] = ' ';
          out[i + 1] = ' ';
          i += 2;
          break;
        }
        out[i] = src[i] === '\n' ? '\n' : ' ';
        i++;
      }
      continue;
    }

    // Raw string literals """ ... """ (C# 11+)
    if (ch === '"' && next === '"' && i + 2 < len && src[i + 2] === '"') {
      let quoteCount = 0;
      while (i < len && src[i] === '"') {
        out[i] = ' ';
        quoteCount++;
        i++;
      }
      while (i < len) {
        if (src[i] === '"') {
          let closeCount = 0;
          const startClose = i;
          while (i < len && src[i] === '"') {
            out[i] = ' ';
            closeCount++;
            i++;
          }
          if (closeCount >= quoteCount) break;
          for (let k = startClose; k < i; k++) out[k] = ' ';
        } else {
          out[i] = src[i] === '\n' ? '\n' : ' ';
          i++;
        }
      }
      continue;
    }

    // Verbatim string @"..." or $@"..." or @$"..."
    if (
      (ch === '@' && next === '"') ||
      (ch === '$' && next === '@' && src[i + 2] === '"') ||
      (ch === '@' && next === '$' && src[i + 2] === '"')
    ) {
      while (i < len && src[i] !== '"') {
        out[i] = ' ';
        i++;
      }
      out[i] = ' ';
      i++;
      while (i < len) {
        if (src[i] === '"' && i + 1 < len && src[i + 1] === '"') {
          out[i] = ' ';
          out[i + 1] = ' ';
          i += 2;
          continue;
        }
        if (src[i] === '"') {
          out[i] = ' ';
          i++;
          break;
        }
        out[i] = src[i] === '\n' ? '\n' : ' ';
        i++;
      }
      continue;
    }

    // Normal / interpolated string literal "..."
    if (ch === '"') {
      out[i] = ' ';
      i++;
      while (i < len) {
        if (src[i] === '\\' && i + 1 < len) {
          out[i] = ' ';
          out[i + 1] = src[i + 1] === '\n' ? '\n' : ' ';
          i += 2;
          continue;
        }
        if (src[i] === '"') {
          out[i] = ' ';
          i++;
          break;
        }
        out[i] = src[i] === '\n' ? '\n' : ' ';
        i++;
      }
      continue;
    }

    // Char literal '.'
    if (ch === '\'') {
      out[i] = ' ';
      i++;
      while (i < len) {
        if (src[i] === '\\' && i + 1 < len) {
          out[i] = ' ';
          out[i + 1] = ' ';
          i += 2;
          continue;
        }
        if (src[i] === '\'') {
          out[i] = ' ';
          i++;
          break;
        }
        if (src[i] === '\n') break;
        out[i] = ' ';
        i++;
      }
      continue;
    }

    out[i] = ch;
    i++;
  }

  return out.join('');
}

/**
 * Split comma-separated list respecting nested <...>, (...), and [...].
 */
function splitTopLevelCommas(text: string): string[] {
  const parts: string[] = [];
  let angle = 0;
  let paren = 0;
  let bracket = 0;
  let start = 0;

  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === '<') angle++;
    else if (c === '>' && angle > 0) angle--;
    else if (c === '(') paren++;
    else if (c === ')' && paren > 0) paren--;
    else if (c === '[') bracket++;
    else if (c === ']' && bracket > 0) bracket--;
    else if (c === ',' && angle === 0 && paren === 0 && bracket === 0) {
      const piece = text.slice(start, i).trim();
      if (piece) parts.push(piece);
      start = i + 1;
    }
  }
  const last = text.slice(start).trim();
  if (last) parts.push(last);
  return parts;
}

/**
 * Find matching closing delimiter starting from opening char index.
 */
function findMatchingDelimiter(text: string, openIdx: number, openCh: string, closeCh: string): number {
  let depth = 0;
  for (let i = openIdx; i < text.length; i++) {
    if (text[i] === openCh) depth++;
    else if (text[i] === closeCh) {
      depth--;
      if (depth === 0) return i;
    }
  }
  return text.length - 1;
}

/**
 * Strip leading attributes like `[HttpGet("{id}")]` from a declaration header.
 */
function stripLeadingAttributes(header: string): string {
  let s = header.trimStart();
  while (s.startsWith('[')) {
    const close = findMatchingDelimiter(s, 0, '[', ']');
    s = s.slice(close + 1).trimStart();
  }
  return s;
}

/**
 * Clean C# type expression (strip nullable `?`, `global::`, namespace prefix, generic args if needed).
 */
export function normalizeTypeName(raw: string): string {
  let t = (raw || '').trim();
  t = t.replace(/^global::/, '');
  // Strip default values or constraints
  t = t.split(/\s*=\s*/)[0].trim();
  // Remove nullable ? suffix
  t = t.replace(/\?+$/, '').trim();
  // Strip generic arguments `<...>` while keeping outer type name
  const ltIdx = t.indexOf('<');
  if (ltIdx !== -1) {
    t = t.slice(0, ltIdx).trim();
  }
  // Strip array brackets
  t = t.replace(/\[.*\]$/, '').trim();
  // If qualified `Namespace.TypeName`, extract `TypeName`
  if (t.includes('.')) {
    t = t.split('.').pop()!.trim();
  }
  return t;
}

function unwrapAsyncOrCollectionType(rawType: string): string {
  const t = (rawType || '').trim();
  const asyncMatch = t.match(/^(?:System\.Threading\.Tasks\.)?(?:Task|ValueTask|ActionResult|IActionResult)<(.+)>$/);
  if (asyncMatch) {
    return unwrapAsyncOrCollectionType(asyncMatch[1]);
  }
  return t;
}

function unwrapEnumerableElementType(rawType: string): string | undefined {
  const unwrapped = unwrapAsyncOrCollectionType(rawType).trim();
  const colMatch = unwrapped.match(
    /^(?:IEnumerable|IReadOnlyList|IReadOnlyCollection|ICollection|IList|List|HashSet|IAsyncEnumerable|DbSet)<(.+)>$/
  );
  if (colMatch) return colMatch[1].trim();
  if (unwrapped.endsWith('[]')) return unwrapped.slice(0, -2).trim();
  return undefined;
}

function parseParameterList(rawParams: string, baseOffset: number, lineStarts: number[]): ParsedParam[] {
  const trimmed = rawParams.trim();
  if (!trimmed) return [];
  const pieces = splitTopLevelCommas(trimmed);
  const result: ParsedParam[] = [];
  let searchFrom = 0;

  for (const piece of pieces) {
    let cleaned = stripLeadingAttributes(piece);
    // Drop default value `= ...`
    const eqIdx = cleaned.indexOf('=');
    if (eqIdx !== -1) cleaned = cleaned.slice(0, eqIdx).trim();
    // Drop parameter modifiers
    cleaned = cleaned.replace(/^(?:this|ref|out|in|params|scoped)\s+/g, '').trim();
    const lastSpace = cleaned.lastIndexOf(' ');
    if (lastSpace <= 0) continue;
    const paramType = cleaned.slice(0, lastSpace).trim();
    const paramName = cleaned.slice(lastSpace + 1).trim();
    if (!paramName || !/^[A-Za-z_@][A-Za-z0-9_]*$/.test(paramName)) continue;

    const relIdx = rawParams.indexOf(paramName, searchFrom);
    if (relIdx !== -1) searchFrom = relIdx + paramName.length;
    const pos = offsetToLineCol(lineStarts, baseOffset + Math.max(0, relIdx));
    result.push({
      name: paramName.replace(/^@/, ''),
      type: paramType,
      line: pos.line,
      column: pos.column
    });
  }

  return result;
}

/**
 * Parse a single C# file cleanly with multi-line support & balanced brace tracking.
 */
function parseCSharpFile(file: SolutionFileItem, project: ProjectItem): ParsedFileInfo {
  const original = file.content || '';
  const stripped = stripCommentsAndStrings(original);
  const lineStarts = buildLineStarts(original);
  const lines = original.split('\n');

  const usings: string[] = [];
  const usingAliases = new Map<string, string>();
  const types: ParsedType[] = [];

  // Extract using directives
  const usingRegex = /^\s*(?:global\s+)?using\s+(?:static\s+)?(?:([A-Za-z_][A-Za-z0-9_]*)\s*=\s*)?([A-Za-z0-9_.]+)\s*;/gm;
  let uMatch: RegExpExecArray | null;
  while ((uMatch = usingRegex.exec(stripped)) !== null) {
    if (uMatch[1]) {
      usingAliases.set(uMatch[1], uMatch[2]);
    } else {
      usings.push(uMatch[2]);
    }
  }

  // Recursive brace-aware parser
  interface BlockContext {
    namespace: string;
    ownerType?: ParsedType;
  }

  function scanScope(startOffset: number, endOffset: number, ctx: BlockContext) {
    let i = startOffset;
    let stmtStart = startOffset;
    let parenDepth = 0;
    let bracketDepth = 0;

    while (i < endOffset) {
      const ch = stripped[i];

      if (ch === '(') parenDepth++;
      else if (ch === ')' && parenDepth > 0) parenDepth--;
      else if (ch === '[') bracketDepth++;
      else if (ch === ']' && bracketDepth > 0) bracketDepth--;

      if (parenDepth === 0 && bracketDepth === 0 && (ch === ';' || ch === '{')) {
        const headerRaw = stripped.slice(stmtStart, i);
        const headerClean = stripLeadingAttributes(headerRaw).replace(/\s+/g, ' ').trim();

        if (ch === ';') {
          // Check file-scoped namespace: `namespace MyApp.Services;`
          const fileNs = headerClean.match(/^namespace\s+([A-Za-z0-9_.]+)$/);
          if (fileNs) {
            ctx = { ...ctx, namespace: fileNs[1] };
          } else if (ctx.ownerType && headerClean) {
            // Inside a type body: interface method signature, abstract method, auto-property, or field!
            parseTypeStatement(headerRaw, headerClean, stmtStart, i, ctx.ownerType, file, project, lineStarts, original);
          }
          i++;
          stmtStart = i;
          continue;
        }

        if (ch === '{') {
          const closeBrace = findMatchingDelimiter(stripped, i, '{', '}');

          // 1. Block namespace `namespace X.Y { ... }`
          const blockNs = headerClean.match(/^namespace\s+([A-Za-z0-9_.]+)$/);
          if (blockNs) {
            scanScope(i + 1, closeBrace, { namespace: blockNs[1], ownerType: ctx.ownerType });
            i = closeBrace + 1;
            stmtStart = i;
            continue;
          }

          // 2. Type declaration (supports multi-line headers, primary constructors, generic args, multiple base interfaces)
          const typeHeaderMatch = headerClean.match(
            /^(?:(?:public|internal|private|protected|abstract|sealed|static|partial|file|new|readonly|ref|unsafe)\s+)*(class|interface|struct|record(?:\s+class|\s+struct)?|enum)\s+([A-Za-z_][A-Za-z0-9_]*)(.*)$/
          );
          if (typeHeaderMatch) {
            const rawKind = typeHeaderMatch[1];
            const kind: ParsedType['kind'] = rawKind.startsWith('record')
              ? 'record'
              : (rawKind as ParsedType['kind']);
            const typeName = typeHeaderMatch[2];
            let tail = typeHeaderMatch[3].trim();

            // Generic params `<T1, T2>`
            let genericParams: string[] = [];
            if (tail.startsWith('<')) {
              const gtClose = findMatchingDelimiter(tail, 0, '<', '>');
              genericParams = splitTopLevelCommas(tail.slice(1, gtClose)).map(g => g.trim());
              tail = tail.slice(gtClose + 1).trim();
            }

            // Primary constructor `(IOrderRepo repo, ...)`
            let primaryCtorParams: ParsedParam[] = [];
            if (tail.startsWith('(')) {
              const pClose = findMatchingDelimiter(tail, 0, '(', ')');
              const rawCtorParams = tail.slice(1, pClose);
              const openParenAbs = original.indexOf('(', stmtStart);
              primaryCtorParams = parseParameterList(
                rawCtorParams,
                openParenAbs !== -1 ? openParenAbs + 1 : stmtStart,
                lineStarts
              );
              tail = tail.slice(pClose + 1).trim();
            }

            // Base types `: BaseClass(...), IService, IRepository<User> where T : class`
            let rawBaseTypes: string[] = [];
            if (tail.startsWith(':')) {
              const baseClause = tail.slice(1).split(/\bwhere\b/)[0].trim();
              rawBaseTypes = splitTopLevelCommas(baseClause).map(b => b.replace(/\(.*\)$/, '').trim()).filter(Boolean);
            }
            const baseTypes = rawBaseTypes.map(normalizeTypeName).filter(Boolean);

            const modifiers = headerClean.slice(0, headerClean.indexOf(rawKind));
            const typeNameAbs = findIdentifierOffset(stripped, stmtStart, i, typeName);
            const pos = offsetToLineCol(lineStarts, typeNameAbs);
            const previewLine = lines[pos.line - 1]?.trim() || headerClean;
            const ns = ctx.namespace || project.name;
            const typeKey = ns ? `${ns}.${typeName}` : typeName;

            const parsedType: ParsedType = {
              key: typeKey,
              name: typeName,
              genericArity: genericParams.length,
              genericParams,
              kind,
              namespace: ns,
              isInterface: kind === 'interface',
              isAbstract: /\babstract\b/.test(modifiers),
              isStatic: /\bstatic\b/.test(modifiers),
              isPartial: /\bpartial\b/.test(modifiers),
              baseTypes,
              rawBaseTypes,
              primaryCtorParams,
              members: [],
              usings,
              file,
              project,
              line: pos.line,
              column: pos.column,
              preview: previewLine,
              bodyStartOffset: i + 1,
              bodyEndOffset: closeBrace
            };

            // Add primary ctor parameters as field/member entries for resolution
            for (const p of primaryCtorParams) {
              parsedType.members.push({
                name: p.name,
                kind: 'field',
                returnType: p.type,
                params: [],
                isAbstract: false,
                isVirtual: false,
                isOverride: false,
                isStatic: false,
                isExtensionMethod: false,
                file,
                project,
                ownerTypeKey: typeKey,
                ownerTypeName: typeName,
                ownerNamespace: ns,
                ownerIsInterface: parsedType.isInterface,
                ownerIsAbstract: parsedType.isAbstract,
                line: p.line,
                column: p.column,
                preview: `${p.type} ${p.name}`
              });
            }

            types.push(parsedType);
            scanScope(i + 1, closeBrace, { namespace: ns, ownerType: parsedType });

            i = closeBrace + 1;
            stmtStart = i;
            continue;
          }

          // 3. Inside a type body: method, constructor, or property `{ get; set; }`
          if (ctx.ownerType) {
            parseTypeBlockMember(
              headerRaw,
              headerClean,
              stmtStart,
              i,
              closeBrace,
              ctx.ownerType,
              file,
              project,
              lineStarts,
              lines
            );
          }

          i = closeBrace + 1;
          stmtStart = i;
          continue;
        }
      }

      i++;
    }
  }

  function parseTypeStatement(
    headerRaw: string,
    headerClean: string,
    stmtStart: number,
    stmtEnd: number,
    owner: ParsedType,
    f: SolutionFileItem,
    p: ProjectItem,
    ls: number[],
    orig: string
  ) {
    // 1. Expression-bodied method: `public User? GetById(int id) => _repo.Find(id);`
    const arrowIdx = headerClean.indexOf('=>');
    if (arrowIdx !== -1) {
      const beforeArrow = headerClean.slice(0, arrowIdx).trim();
      if (beforeArrow.includes('(')) {
        const parenOpen = beforeArrow.indexOf('(');
        const beforeParen = beforeArrow.slice(0, parenOpen).trim();
        const parenClose = beforeArrow.lastIndexOf(')');
        const rawParams = parenClose > parenOpen ? beforeArrow.slice(parenOpen + 1, parenClose) : '';
        const methodMatch = beforeParen.match(/(?:^|\s)(?:([A-Za-z_][A-Za-z0-9_<>\[\],\?\s\.]*?)\s+)?([A-Za-z_][A-Za-z0-9_.]*)\s*(?:<[^>]+>)?$/);
        if (methodMatch) {
          const fullMethodName = methodMatch[2];
          const dotIdx = fullMethodName.lastIndexOf('.');
          const methodName = dotIdx !== -1 ? fullMethodName.slice(dotIdx + 1) : fullMethodName;
          const explicitInterface = dotIdx !== -1 ? normalizeTypeName(fullMethodName.slice(0, dotIdx)) : undefined;
          const returnType = (methodMatch[1] || 'void').replace(/^(?:public|private|protected|internal|static|virtual|override|abstract|async|sealed|new|partial)\s+/g, '').trim();
          const nameOffset = findIdentifierOffset(stripped, stmtStart, stmtEnd, methodName);
          const pos = offsetToLineCol(ls, nameOffset);
          owner.members.push({
            name: methodName,
            kind: 'method',
            returnType: cleanReturnType(returnType),
            explicitInterface,
            params: parseParameterList(rawParams, stmtStart + Math.max(0, headerRaw.indexOf('(')) + 1, ls),
            isAbstract: false,
            isVirtual: /\bvirtual\b/.test(headerClean),
            isOverride: /\boverride\b/.test(headerClean),
            isStatic: /\bstatic\b/.test(headerClean),
            isExtensionMethod: /\bthis\s+/.test(rawParams),
            file: f,
            project: p,
            ownerTypeKey: owner.key,
            ownerTypeName: owner.name,
            ownerNamespace: owner.namespace,
            ownerIsInterface: owner.isInterface,
            ownerIsAbstract: owner.isAbstract,
            line: pos.line,
            column: pos.column,
            preview: lines[pos.line - 1]?.trim() || headerClean,
            bodyStartOffset: stmtStart,
            bodyEndOffset: stmtEnd
          });
          return;
        }
      } else {
        // Expression-bodied property `public IRepo Orders => _orders;`
        const propExpr = beforeArrow.match(/(?:(?:public|private|protected|internal|static|virtual|override|new)\s+)*([A-Za-z_][A-Za-z0-9_<>\[\],\?\.]*)\s+([A-Za-z_][A-Za-z0-9_]*)$/);
        if (propExpr) {
          const propName = propExpr[2];
          const nameOffset = findIdentifierOffset(stripped, stmtStart, stmtEnd, propName);
          const pos = offsetToLineCol(ls, nameOffset);
          owner.members.push({
            name: propName,
            kind: 'property',
            returnType: propExpr[1].trim(),
            params: [],
            isAbstract: false,
            isVirtual: /\bvirtual\b/.test(headerClean),
            isOverride: /\boverride\b/.test(headerClean),
            isStatic: /\bstatic\b/.test(headerClean),
            isExtensionMethod: false,
            file: f,
            project: p,
            ownerTypeKey: owner.key,
            ownerTypeName: owner.name,
            ownerNamespace: owner.namespace,
            ownerIsInterface: owner.isInterface,
            ownerIsAbstract: owner.isAbstract,
            line: pos.line,
            column: pos.column,
            preview: lines[pos.line - 1]?.trim() || headerClean
          });
          return;
        }
      }
    }

    // 2. Interface or abstract method signature ending with `;`
    if (headerClean.includes('(') && !headerClean.includes('=')) {
      const noConstraints = headerClean.split(/\bwhere\b/)[0].trim();
      const parenOpen = noConstraints.indexOf('(');
      const parenClose = noConstraints.lastIndexOf(')');
      if (parenOpen > 0 && parenClose > parenOpen) {
        const beforeParen = noConstraints.slice(0, parenOpen).trim();
        const rawParams = noConstraints.slice(parenOpen + 1, parenClose);
        const mMatch = beforeParen.match(/^(.*?)\s+([A-Za-z_][A-Za-z0-9_.]*)\s*(?:<[^>]+>)?$/);
        if (mMatch && !/\bdelegate\b|\bevent\b/.test(mMatch[1])) {
          const fullMethodName = mMatch[2];
          const dotIdx = fullMethodName.lastIndexOf('.');
          const methodName = dotIdx !== -1 ? fullMethodName.slice(dotIdx + 1) : fullMethodName;
          const explicitInterface = dotIdx !== -1 ? normalizeTypeName(fullMethodName.slice(0, dotIdx)) : undefined;
          const returnType = cleanReturnType(mMatch[1]);
          const nameOffset = findIdentifierOffset(stripped, stmtStart, stmtEnd, methodName);
          const pos = offsetToLineCol(ls, nameOffset);
          owner.members.push({
            name: methodName,
            kind: 'method',
            returnType,
            explicitInterface,
            params: parseParameterList(rawParams, stmtStart + Math.max(0, orig.slice(stmtStart, stmtEnd).indexOf('(')) + 1, ls),
            isAbstract: owner.isInterface || /\babstract\b/.test(headerClean),
            isVirtual: /\bvirtual\b/.test(headerClean),
            isOverride: /\boverride\b/.test(headerClean),
            isStatic: /\bstatic\b/.test(headerClean),
            isExtensionMethod: /\bthis\s+/.test(rawParams),
            file: f,
            project: p,
            ownerTypeKey: owner.key,
            ownerTypeName: owner.name,
            ownerNamespace: owner.namespace,
            ownerIsInterface: owner.isInterface,
            ownerIsAbstract: owner.isAbstract,
            line: pos.line,
            column: pos.column,
            preview: lines[pos.line - 1]?.trim() || headerClean
          });
          return;
        }
      }
    }

    // 3. Field declaration: `private readonly IOrderService _service;` or `private readonly IRepo _a = ..., _b;`
    if (!headerClean.startsWith('using ') && !headerClean.startsWith('namespace ')) {
      const noInit = headerClean.split('=')[0].trim();
      const fieldMatch = noInit.match(
        /^(?:(?:private|public|protected|internal|readonly|static|volatile|const|new|required)\s+)*([A-Za-z_][A-Za-z0-9_<>\[\],\?\s\.]*?)\s+([A-Za-z_][A-Za-z0-9_]*(?:\s*,\s*[A-Za-z_][A-Za-z0-9_]*)*)$/
      );
      if (fieldMatch) {
        const rawType = cleanReturnType(fieldMatch[1]);
        if (rawType && !['return', 'throw', 'await', 'var', 'event', 'delegate'].includes(rawType)) {
          const names = fieldMatch[2].split(',').map(n => n.trim()).filter(Boolean);
          for (const fieldName of names) {
            const nameOffset = findIdentifierOffset(stripped, stmtStart, stmtEnd, fieldName);
            const pos = offsetToLineCol(ls, nameOffset);
            owner.members.push({
              name: fieldName,
              kind: 'field',
              returnType: rawType,
              params: [],
              isAbstract: false,
              isVirtual: false,
              isOverride: false,
              isStatic: /\bstatic\b/.test(headerClean),
              isExtensionMethod: false,
              file: f,
              project: p,
              ownerTypeKey: owner.key,
              ownerTypeName: owner.name,
              ownerNamespace: owner.namespace,
              ownerIsInterface: owner.isInterface,
              ownerIsAbstract: owner.isAbstract,
              line: pos.line,
              column: pos.column,
              preview: lines[pos.line - 1]?.trim() || headerClean
            });
          }
        }
      }
    }
  }

  function parseTypeBlockMember(
    headerRaw: string,
    headerClean: string,
    stmtStart: number,
    braceOpen: number,
    braceClose: number,
    owner: ParsedType,
    f: SolutionFileItem,
    p: ProjectItem,
    ls: number[],
    srcLines: string[]
  ) {
    // Strip constructor `: base(...)` or `: this(...)` and generic `where T : ...`
    const parenIdx = headerClean.indexOf('(');

    // 1. Property `{ get; set; }` (no `(` before property name, or only attributes had `(` which were stripped)
    if (parenIdx === -1) {
      const propMatch = headerClean.match(
        /^(?:(?:public|private|protected|internal|static|virtual|override|abstract|required|new|sealed)\s+)*([A-Za-z_][A-Za-z0-9_<>\[\],\?\s\.]*?)\s+([A-Za-z_][A-Za-z0-9_.]*)$/
      );
      if (propMatch) {
        const fullName = propMatch[2];
        const dotIdx = fullName.lastIndexOf('.');
        const propName = dotIdx !== -1 ? fullName.slice(dotIdx + 1) : fullName;
        const explicitInterface = dotIdx !== -1 ? normalizeTypeName(fullName.slice(0, dotIdx)) : undefined;
        const nameOffset = findIdentifierOffset(stripped, stmtStart, braceOpen, propName);
        const pos = offsetToLineCol(ls, nameOffset);
        owner.members.push({
          name: propName,
          kind: 'property',
          returnType: cleanReturnType(propMatch[1]),
          explicitInterface,
          params: [],
          isAbstract: owner.isInterface || /\babstract\b/.test(headerClean),
          isVirtual: /\bvirtual\b/.test(headerClean),
          isOverride: /\boverride\b/.test(headerClean),
          isStatic: /\bstatic\b/.test(headerClean),
          isExtensionMethod: false,
          file: f,
          project: p,
          ownerTypeKey: owner.key,
          ownerTypeName: owner.name,
          ownerNamespace: owner.namespace,
          ownerIsInterface: owner.isInterface,
          ownerIsAbstract: owner.isAbstract,
          line: pos.line,
          column: pos.column,
          preview: srcLines[pos.line - 1]?.trim() || headerClean,
          bodyStartOffset: braceOpen + 1,
          bodyEndOffset: braceClose
        });
      }
      return;
    }

    // 2. Method or Constructor `{ ... }`
    const parenClose = findMatchingDelimiter(headerClean, parenIdx, '(', ')');
    const beforeParen = headerClean.slice(0, parenIdx).trim();
    const rawParams = headerClean.slice(parenIdx + 1, parenClose);

    const openParenAbs = stripped.indexOf('(', stmtStart);
    const parsedParams = parseParameterList(rawParams, openParenAbs !== -1 ? openParenAbs + 1 : stmtStart, ls);

    // Constructor: `public ClassName(...)`
    const tokensBefore = beforeParen.split(/\s+/).filter(Boolean);
    const lastToken = tokensBefore[tokensBefore.length - 1] || '';
    if (lastToken === owner.name && !tokensBefore.slice(0, -1).some(t => !isModifier(t))) {
      const nameOffset = findIdentifierOffset(stripped, stmtStart, braceOpen, owner.name);
      const pos = offsetToLineCol(ls, nameOffset);
      owner.members.push({
        name: owner.name,
        kind: 'ctor',
        returnType: owner.name,
        params: parsedParams,
        isAbstract: false,
        isVirtual: false,
        isOverride: false,
        isStatic: /\bstatic\b/.test(beforeParen),
        isExtensionMethod: false,
        file: f,
        project: p,
        ownerTypeKey: owner.key,
        ownerTypeName: owner.name,
        ownerNamespace: owner.namespace,
        ownerIsInterface: owner.isInterface,
        ownerIsAbstract: owner.isAbstract,
        line: pos.line,
        column: pos.column,
        preview: srcLines[pos.line - 1]?.trim() || headerClean,
        bodyStartOffset: braceOpen + 1,
        bodyEndOffset: braceClose
      });
      return;
    }

    // Regular or Explicit Interface Method: `public async Task<User> GetAsync(...)`
    const mMatch = beforeParen.match(/^(.*?)\s+([A-Za-z_][A-Za-z0-9_.]*)\s*(?:<[^>]+>)?$/);
    if (mMatch) {
      const fullMethodName = mMatch[2];
      const dotIdx = fullMethodName.lastIndexOf('.');
      const methodName = dotIdx !== -1 ? fullMethodName.slice(dotIdx + 1) : fullMethodName;
      const explicitInterface = dotIdx !== -1 ? normalizeTypeName(fullMethodName.slice(0, dotIdx)) : undefined;
      const nameOffset = findIdentifierOffset(stripped, stmtStart, braceOpen, methodName);
      const pos = offsetToLineCol(ls, nameOffset);

      owner.members.push({
        name: methodName,
        kind: 'method',
        returnType: cleanReturnType(mMatch[1]),
        explicitInterface,
        params: parsedParams,
        isAbstract: owner.isInterface || /\babstract\b/.test(beforeParen),
        isVirtual: /\bvirtual\b/.test(beforeParen),
        isOverride: /\boverride\b/.test(beforeParen),
        isStatic: /\bstatic\b/.test(beforeParen),
        isExtensionMethod: /\bthis\s+/.test(rawParams),
        file: f,
        project: p,
        ownerTypeKey: owner.key,
        ownerTypeName: owner.name,
        ownerNamespace: owner.namespace,
        ownerIsInterface: owner.isInterface,
        ownerIsAbstract: owner.isAbstract,
        line: pos.line,
        column: pos.column,
        preview: srcLines[pos.line - 1]?.trim() || headerClean,
        bodyStartOffset: braceOpen + 1,
        bodyEndOffset: braceClose
      });
    }
  }

  scanScope(0, stripped.length, { namespace: project.name });

  return {
    file,
    project,
    original,
    stripped,
    lineStarts,
    lines,
    usings,
    usingAliases,
    types
  };
}

function isModifier(tok: string): boolean {
  return [
    'public', 'private', 'protected', 'internal', 'static', 'readonly', 'abstract',
    'virtual', 'override', 'sealed', 'async', 'extern', 'unsafe', 'partial', 'new', 'file'
  ].includes(tok);
}

function cleanReturnType(raw: string): string {
  const cleaned = raw
    .split(/\s+/)
    .filter(tok => !isModifier(tok))
    .join(' ')
    .trim();
  return cleaned || 'void';
}

function findIdentifierOffset(text: string, from: number, to: number, identifier: string): number {
  const slice = text.slice(from, to);
  const escaped = identifier.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = new RegExp(`\\b${escaped}\\b`).exec(slice);
  if (match) {
    return from + match.index;
  }
  return from;
}

/**
 * Build or retrieve cached SolutionSemanticIndex with full inheritance, DI bindings, MediatR handlers & project dependency graph.
 */
export function getOrBuildSolutionIndex(solution: SolutionFile): SolutionSemanticIndex {
  const csFiles = getAllSolutionFiles(solution).filter(
    f => f.file.extension === '.cs' && f.file.content
  );
  const fingerprint = computeSolutionFingerprint(solution, csFiles);
  if (cachedIndex && cachedIndex.fingerprint === fingerprint) {
    return cachedIndex.index;
  }

  const parsedFiles = csFiles.map(item => parseCSharpFile(item.file, item.project));
  const typesByName = new Map<string, ParsedType[]>();
  const typesByKey = new Map<string, ParsedType[]>();
  const implementationsByBase = new Map<string, ParsedType[]>();
  const ancestorsByTypeKey = new Map<string, Set<string>>();
  const diBindingsByService = new Map<string, DiBinding[]>();
  const requestHandlerByRequest = new Map<string, ParsedType[]>();
  const allMethodsByName = new Map<string, ParsedMember[]>();

  // 1. Transitive Project Dependency Closure
  const directDeps = new Map<string, string[]>();
  for (const p of solution.projects) {
    directDeps.set(p.name, p.dependencies?.projectReferences || []);
  }
  const projectDeps = new Map<string, Set<string>>();
  for (const p of solution.projects) {
    const closure = new Set<string>([p.name]);
    const queue = [...(directDeps.get(p.name) || [])];
    while (queue.length > 0) {
      const next = queue.shift()!;
      if (!closure.has(next)) {
        closure.add(next);
        for (const sub of directDeps.get(next) || []) {
          queue.push(sub);
        }
      }
    }
    projectDeps.set(p.name, closure);
  }

  // 2. Register all parsed types & methods
  for (const pf of parsedFiles) {
    for (const t of pf.types) {
      if (!typesByName.has(t.name)) typesByName.set(t.name, []);
      typesByName.get(t.name)!.push(t);

      if (!typesByKey.has(t.key)) typesByKey.set(t.key, []);
      typesByKey.get(t.key)!.push(t);

      for (const m of t.members) {
        if (m.kind === 'method' || m.kind === 'property') {
          if (!allMethodsByName.has(m.name)) allMethodsByName.set(m.name, []);
          allMethodsByName.get(m.name)!.push(m);
        }
      }
    }

    // 3. Scan DI registrations (`AddScoped<IFoo, Foo>`, `AddTransient`, `AddSingleton`, `AddHostedService`)
    const diGenericRegex = /\.(?:Try)?Add(?:Scoped|Transient|Singleton|KeyedScoped|KeyedTransient|KeyedSingleton)\s*<\s*([A-Za-z0-9_.<>]+)\s*,\s*([A-Za-z0-9_.<>]+)\s*>/g;
    let dMatch: RegExpExecArray | null;
    while ((dMatch = diGenericRegex.exec(pf.stripped)) !== null) {
      const svc = normalizeTypeName(dMatch[1]);
      const impl = normalizeTypeName(dMatch[2]);
      if (svc && impl) {
        const pos = offsetToLineCol(pf.lineStarts, dMatch.index);
        if (!diBindingsByService.has(svc)) diBindingsByService.set(svc, []);
        diBindingsByService.get(svc)!.push({ serviceType: svc, implType: impl, file: pf.file, line: pos.line });
      }
    }

    const diTypeofRegex = /\.(?:Try)?Add(?:Scoped|Transient|Singleton)\s*\(\s*typeof\s*\(\s*([A-Za-z0-9_.<>]+)\s*\)\s*,\s*typeof\s*\(\s*([A-Za-z0-9_.<>]+)\s*\)/g;
    while ((dMatch = diTypeofRegex.exec(pf.stripped)) !== null) {
      const svc = normalizeTypeName(dMatch[1]);
      const impl = normalizeTypeName(dMatch[2]);
      if (svc && impl) {
        const pos = offsetToLineCol(pf.lineStarts, dMatch.index);
        if (!diBindingsByService.has(svc)) diBindingsByService.set(svc, []);
        diBindingsByService.get(svc)!.push({ serviceType: svc, implType: impl, file: pf.file, line: pos.line });
      }
    }
  }

  // Merge partial class baseTypes across partial declarations
  for (const [, partials] of typesByKey.entries()) {
    if (partials.length > 1) {
      const mergedBase = [...new Set(partials.flatMap(pt => pt.baseTypes))];
      const mergedRaw = [...new Set(partials.flatMap(pt => pt.rawBaseTypes))];
      partials.forEach(pt => {
        pt.baseTypes = mergedBase;
        pt.rawBaseTypes = mergedRaw;
      });
    }
  }

  // 4. Compute transitive inheritance closure & MediatR/CQRS handler bindings
  for (const pf of parsedFiles) {
    for (const t of pf.types) {
      const ancestors = new Set<string>();
      const queue = [...t.baseTypes];
      while (queue.length > 0) {
        const baseName = queue.shift()!;
        if (!ancestors.has(baseName)) {
          ancestors.add(baseName);
          for (const baseDef of typesByName.get(baseName) || []) {
            for (const nextBase of baseDef.baseTypes) {
              queue.push(nextBase);
            }
          }
        }
      }
      ancestorsByTypeKey.set(t.key, ancestors);

      for (const anc of ancestors) {
        if (!implementationsByBase.has(anc)) implementationsByBase.set(anc, []);
        implementationsByBase.get(anc)!.push(t);
      }

      // MediatR / CQRS handler pattern: IRequestHandler<TReq, TRes>, ICommandHandler<TCmd>, IQueryHandler<TQry>, INotificationHandler<TNotif>
      for (const rawBase of t.rawBaseTypes) {
        const hMatch = rawBase.match(
          /(?:IRequestHandler|ICommandHandler|IQueryHandler|INotificationHandler|IValidator)<\s*([^,>]+)/
        );
        if (hMatch) {
          const reqType = normalizeTypeName(hMatch[1]);
          if (reqType) {
            if (!requestHandlerByRequest.has(reqType)) requestHandlerByRequest.set(reqType, []);
            requestHandlerByRequest.get(reqType)!.push(t);
          }
        }
      }
    }
  }

  // Also link DI bindings into implementationsByBase when explicit class inheritance wasn't already recorded
  for (const [svc, bindings] of diBindingsByService.entries()) {
    for (const b of bindings) {
      const implTypes = typesByName.get(b.implType) || [];
      for (const implT of implTypes) {
        if (!implementationsByBase.has(svc)) implementationsByBase.set(svc, []);
        if (!implementationsByBase.get(svc)!.some(x => x.key === implT.key && x.file.path === implT.file.path)) {
          implementationsByBase.get(svc)!.push(implT);
        }
      }
    }
  }

  const index: SolutionSemanticIndex = {
    solutionKey: solution.path,
    files: parsedFiles,
    typesByName,
    typesByKey,
    implementationsByBase,
    ancestorsByTypeKey,
    diBindingsByService,
    requestHandlerByRequest,
    projectDeps,
    allMethodsByName
  };

  cachedIndex = { fingerprint, index };
  return index;
}

/**
 * Rank candidates by project dependency closure & using directives so references inside dependent projects always win.
 */
function scoreCandidate(
  candidateProject: ProjectItem,
  candidateNamespace: string,
  candidateFilePath: string,
  sourceFileInfo: ParsedFileInfo | undefined,
  index: SolutionSemanticIndex
): number {
  let score = 0;
  if (!sourceFileInfo) return score;

  // Same file gets boost for local clarity
  if (candidateFilePath === sourceFileInfo.file.path) score += 40;

  // Same project
  if (candidateProject.name === sourceFileInfo.project.name) score += 30;
  // Direct or transitive ProjectReference
  else if (index.projectDeps.get(sourceFileInfo.project.name)?.has(candidateProject.name)) {
    score += 20;
  }

  // Matching `using` namespace
  if (sourceFileInfo.usings.includes(candidateNamespace)) {
    score += 15;
  }

  // Deprioritize unit test mocks when real production implementations exist
  const lowerPath = candidateFilePath.toLowerCase();
  if (candidateProject.projectType === 'test' || lowerPath.includes('.tests') || lowerPath.includes('/tests/')) {
    score -= 10;
  }

  return score;
}

/**
 * Extract full dotted access chain before/at cursor, e.g. `_unitOfWork.Orders.GetByIdAsync` -> ['_unitOfWork', 'Orders', 'GetByIdAsync']
 */
export function extractSymbolContext(
  content: string,
  line: number,
  column: number,
  explicitWord?: string
): { word: string; receiver?: string; chain: string[]; isConstructorCall: boolean } {
  const lines = content.split('\n');
  const lineText = lines[Math.max(0, line - 1)] || '';
  const colIdx = Math.max(0, Math.min(lineText.length, column - 1));

  let word = explicitWord || '';
  let start = colIdx;

  if (!word) {
    const isIdChar = (ch: string) => /[A-Za-z0-9_]/.test(ch);
    let s = colIdx;
    let e = colIdx;
    if (s > 0 && !isIdChar(lineText[s]) && isIdChar(lineText[s - 1])) {
      s--;
      e = s;
    }
    while (s > 0 && isIdChar(lineText[s - 1])) s--;
    while (e < lineText.length && isIdChar(lineText[e])) e++;
    word = lineText.slice(s, e);
    start = s;
  } else {
    const idx = lineText.indexOf(word, Math.max(0, colIdx - word.length));
    if (idx !== -1) start = idx;
  }

  if (!word) {
    return { word: '', chain: [], isConstructorCall: false };
  }

  // Check if preceded by `new ` (constructor / type instantiation)
  const beforeWord = lineText.slice(0, start);
  const isConstructorCall = /\bnew\s+$/.test(beforeWord);

  // Build dotted receiver chain backwards (handles multi-line fluent calls too!)
  const lineStarts = buildLineStarts(content);
  const wordAbsStart = lineColToOffset(lineStarts, line, start + 1);
  const lookback = content.slice(Math.max(0, wordAbsStart - 300), wordAbsStart);
  const chain: string[] = [word];

  let cursor = lookback.length;
  while (cursor > 0) {
    while (cursor > 0 && /\s/.test(lookback[cursor - 1])) cursor--;
    if (cursor > 0 && lookback[cursor - 1] === '?') cursor--;
    if (cursor <= 0 || lookback[cursor - 1] !== '.') break;
    cursor--; // skip '.'
    while (cursor > 0 && /\s/.test(lookback[cursor - 1])) cursor--;

    // Skip method invocation arguments `(...)` or generic args `<...>` on receiver step
    if (cursor > 0 && lookback[cursor - 1] === ')') {
      let depth = 1;
      cursor--;
      while (cursor > 0 && depth > 0) {
        cursor--;
        if (lookback[cursor] === ')') depth++;
        else if (lookback[cursor] === '(') depth--;
      }
      while (cursor > 0 && /\s/.test(lookback[cursor - 1])) cursor--;
    }
    if (cursor > 0 && lookback[cursor - 1] === '>') {
      let depth = 1;
      cursor--;
      while (cursor > 0 && depth > 0) {
        cursor--;
        if (lookback[cursor] === '>') depth++;
        else if (lookback[cursor] === '<') depth--;
      }
    }

    const endId = cursor;
    while (cursor > 0 && /[A-Za-z0-9_]/.test(lookback[cursor - 1])) cursor--;
    const id = lookback.slice(cursor, endId);
    if (!id) break;
    chain.unshift(id);
  }

  const receiver = chain.length >= 2 ? chain[chain.length - 2] : undefined;
  return { word, receiver, chain, isConstructorCall };
}

/**
 * Find enclosing type & method for a given (line, column) inside a parsed file.
 */
function findEnclosingContext(
  pf: ParsedFileInfo | undefined,
  line: number,
  column: number
): { enclosingType?: ParsedType; enclosingMethod?: ParsedMember; cursorOffset: number } {
  if (!pf) return { cursorOffset: 0 };
  const cursorOffset = lineColToOffset(pf.lineStarts, line, column);

  // Pick innermost enclosing type
  let enclosingType: ParsedType | undefined;
  for (const t of pf.types) {
    if (cursorOffset >= t.bodyStartOffset - 1 && cursorOffset <= t.bodyEndOffset + 1) {
      if (!enclosingType || t.bodyStartOffset > enclosingType.bodyStartOffset) {
        enclosingType = t;
      }
    }
  }

  let enclosingMethod: ParsedMember | undefined;
  if (enclosingType) {
    for (const m of enclosingType.members) {
      if (
        m.bodyStartOffset !== undefined &&
        m.bodyEndOffset !== undefined &&
        cursorOffset >= m.bodyStartOffset &&
        cursorOffset <= m.bodyEndOffset
      ) {
        enclosingMethod = m;
      }
    }
  }

  return { enclosingType, enclosingMethod, cursorOffset };
}

/**
 * Look up a field, property, or method on a named type (traversing base classes & interfaces!).
 */
function findMemberOnTypeHierarchy(
  typeName: string,
  memberName: string,
  index: SolutionSemanticIndex,
  visited = new Set<string>()
): ParsedMember | undefined {
  const clean = normalizeTypeName(typeName);
  if (!clean || visited.has(clean)) return undefined;
  visited.add(clean);

  const candidates = index.typesByName.get(clean) || [];
  for (const t of candidates) {
    const direct = t.members.find(m => m.name === memberName);
    if (direct) return direct;

    for (const base of t.baseTypes) {
      const inherited = findMemberOnTypeHierarchy(base, memberName, index, visited);
      if (inherited) return inherited;
    }
  }
  return undefined;
}

/**
 * Resolve the C# type of an identifier (`_service`, `repo`, local `var x = ...`, or static Type name) at cursor!
 */
function resolveIdentifierType(
  identName: string,
  pf: ParsedFileInfo | undefined,
  enclosingType: ParsedType | undefined,
  enclosingMethod: ParsedMember | undefined,
  cursorOffset: number,
  index: SolutionSemanticIndex
): string | undefined {
  if (!identName || !pf) return undefined;

  if (identName === 'this' && enclosingType) {
    return enclosingType.name;
  }

  // 1. Check using alias (e.g. `using Alias = MyNamespace.RealType;`)
  if (pf.usingAliases.has(identName)) {
    return normalizeTypeName(pf.usingAliases.get(identName)!);
  }

  // 2. Check enclosing method parameters
  if (enclosingMethod) {
    const param = enclosingMethod.params.find(p => p.name === identName);
    if (param) return param.type;

    // 3. Check local declarations inside enclosing method body up to cursor
    if (enclosingMethod.bodyStartOffset !== undefined) {
      const methodSlice = pf.stripped.slice(enclosingMethod.bodyStartOffset, cursorOffset);
      const esc = identName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

      // Explicit local variable: `IOrderService svc = ...;` or `OrderDto dto;`
      const explicitLocal = new RegExp(
        `\\b([A-Za-z_][A-Za-z0-9_<>,\\?\\.\\[\\]]*)\\s+${esc}\\s*(?:=|;|\\bin\\b)`
      );
      const eMatch = methodSlice.match(explicitLocal);
      if (eMatch && eMatch[1] && !['var', 'return', 'new', 'await', 'using', 'out', 'ref', 'throw', 'case'].includes(eMatch[1])) {
        return eMatch[1];
      }

      // `var x = new OrderService(...)`
      const varNewMatch = pf.original
        .slice(enclosingMethod.bodyStartOffset, cursorOffset)
        .match(new RegExp(`\\bvar\\s+${esc}\\s*=\\s*(?:await\\s+)?new\\s+([A-Za-z_][A-Za-z0-9_<>.]+)`));
      if (varNewMatch && varNewMatch[1]) {
        return varNewMatch[1];
      }

      // `var x = provider.GetRequiredService<IOrderService>()` / `GetService<IOrderService>()`
      const varDiMatch = pf.original
        .slice(enclosingMethod.bodyStartOffset, cursorOffset)
        .match(new RegExp(`\\bvar\\s+${esc}\\s*=\\s*[^;]*\\.Get(?:Required|Keyed)?Service<([^>]+)>`));
      if (varDiMatch && varDiMatch[1]) {
        return varDiMatch[1].trim();
      }

      // `var x = await _service.GetOrderAsync(...)` -> trace receiver call return type!
      const varCallMatch = pf.original
        .slice(enclosingMethod.bodyStartOffset, cursorOffset)
        .match(new RegExp(`\\bvar\\s+${esc}\\s*=\\s*(?:await\\s+)?([A-Za-z_][A-Za-z0-9_\\.]*)\\.([A-Za-z_][A-Za-z0-9_]*)\\s*(?:<[^>]+>)?\\(`));
      if (varCallMatch) {
        const lhsChain = varCallMatch[1].split('.');
        const methodName = varCallMatch[2];
        const targetType = resolveChainTargetType(lhsChain, pf, enclosingType, enclosingMethod, cursorOffset, index);
        if (targetType) {
          const calledMember = findMemberOnTypeHierarchy(targetType, methodName, index);
          if (calledMember) {
            return unwrapAsyncOrCollectionType(calledMember.returnType);
          }
        }
      }

      // `foreach (var item in collection)`
      const foreachMatch = pf.original
        .slice(enclosingMethod.bodyStartOffset, cursorOffset)
        .match(new RegExp(`foreach\\s*\\(\\s*var\\s+${esc}\\s+in\\s+([A-Za-z_][A-Za-z0-9_\\.]*)`));
      if (foreachMatch && foreachMatch[1]) {
        const colType = resolveChainTargetType(foreachMatch[1].split('.'), pf, enclosingType, enclosingMethod, cursorOffset, index);
        if (colType) {
          const elem = unwrapEnumerableElementType(colType);
          if (elem) return elem;
        }
      }
    }
  }

  // 4. Enclosing type members (fields, properties, primary ctor params) AND inherited base classes
  if (enclosingType) {
    const member = findMemberOnTypeHierarchy(enclosingType.name, identName, index);
    if (member) return member.returnType;

    // Constructor parameters assigned or used in file: check any ctor on enclosingType
    for (const m of enclosingType.members) {
      if (m.kind === 'ctor') {
        const ctorParam = m.params.find(p => p.name === identName);
        if (ctorParam) return ctorParam.type;
      }
    }
  }

  // 5. Fallback: is identName itself a known Type name (for static access like `OrderMapper.Map(...)`)?
  if (index.typesByName.has(identName)) {
    return identName;
  }

  return undefined;
}

/**
 * Walk a dotted chain like `['_unitOfWork', 'Orders']` to find the resolved type of the receiver before the final member.
 */
function resolveChainTargetType(
  receiverChain: string[],
  pf: ParsedFileInfo | undefined,
  enclosingType: ParsedType | undefined,
  enclosingMethod: ParsedMember | undefined,
  cursorOffset: number,
  index: SolutionSemanticIndex
): string | undefined {
  if (receiverChain.length === 0) return enclosingType?.name;

  let currentType = resolveIdentifierType(
    receiverChain[0],
    pf,
    enclosingType,
    enclosingMethod,
    cursorOffset,
    index
  );
  if (!currentType) return undefined;

  for (let i = 1; i < receiverChain.length; i++) {
    const seg = receiverChain[i];
    const member = findMemberOnTypeHierarchy(currentType, seg, index);
    if (!member) return undefined;
    currentType = unwrapAsyncOrCollectionType(member.returnType);
  }

  return currentType;
}

function toImplementationItem(
  item: {
    name: string;
    kind: ImplementationItem['kind'];
    file: SolutionFileItem;
    line: number;
    column: number;
    preview: string;
    containerName?: string;
  }
): ImplementationItem {
  return {
    name: item.name,
    kind: item.kind,
    file: item.file.path,
    line: item.line,
    column: item.column,
    preview: item.preview,
    containerName: item.containerName
  };
}

function dedupeTargets(items: ImplementationItem[]): ImplementationItem[] {
  const seen = new Set<string>();
  const out: ImplementationItem[] = [];
  for (const item of items) {
    const key = `${item.file}::${item.line}::${item.name}`;
    if (!seen.has(key)) {
      seen.add(key);
      out.push(item);
    }
  }
  return out;
}

/**
 * Go to Definition (Cmd+Click, Ctrl+Click, Cmd+B, F12)
 */
export function resolveCSharpDefinition(
  solution: SolutionFile,
  currentFile: SolutionFileItem,
  line: number,
  column: number,
  explicitWord?: string
): NavigationResult {
  const content = currentFile.content || '';
  const { word, chain, isConstructorCall } = extractSymbolContext(content, line, column, explicitWord);
  if (!word) return { symbolName: '', targets: [] };

  const index = getOrBuildSolutionIndex(solution);
  const pf = index.files.find(f => f.file.path === currentFile.path);
  const { enclosingType, enclosingMethod, cursorOffset } = findEnclosingContext(pf, line, column);

  // 1. Constructor instantiation `new OrderService(...)` -> jump to ctor (if defined) or type declaration
  if (isConstructorCall) {
    const clean = normalizeTypeName(word);
    const matchedTypes = (index.typesByName.get(clean) || []).sort(
      (a, b) =>
        scoreCandidate(b.project, b.namespace, b.file.path, pf, index) -
        scoreCandidate(a.project, a.namespace, a.file.path, pf, index)
    );
    if (matchedTypes.length > 0) {
      const targets: ImplementationItem[] = [];
      for (const t of matchedTypes) {
        const ctors = t.members.filter(m => m.kind === 'ctor');
        if (ctors.length > 0) {
          ctors.forEach(c =>
            targets.push(
              toImplementationItem({
                name: `${t.name}(...)`,
                kind: 'method',
                file: c.file,
                line: c.line,
                column: c.column,
                preview: c.preview,
                containerName: t.namespace
              })
            )
          );
        } else {
          targets.push(
            toImplementationItem({
              name: t.name,
              kind: t.isInterface ? 'interface' : 'class',
              file: t.file,
              line: t.line,
              column: t.column,
              preview: t.preview,
              containerName: t.namespace
            })
          );
        }
      }
      return { symbolName: clean, targets: dedupeTargets(targets) };
    }
  }

  // 2. Dotted member access `receiverChain.Word` -> resolve receiver type then member definition!
  if (chain.length >= 2) {
    const receiverChain = chain.slice(0, -1);
    const receiverRawType = resolveChainTargetType(receiverChain, pf, enclosingType, enclosingMethod, cursorOffset, index);
    if (receiverRawType) {
      const receiverTypeName = normalizeTypeName(receiverRawType);
      const member = findMemberOnTypeHierarchy(receiverTypeName, word, index);
      if (member) {
        return {
          symbolName: `${receiverTypeName}.${word}`,
          targets: [
            toImplementationItem({
              name: `${member.ownerTypeName}.${member.name}`,
              kind: member.kind === 'property' || member.kind === 'field' ? 'property' : 'method',
              file: member.file,
              line: member.line,
              column: member.column,
              preview: member.preview,
              containerName: member.ownerNamespace
            })
          ]
        };
      }
    }
  }

  // 3. Direct Type name (`IOrderService`, `UserDto`, `OrderRepository`)
  const typeMatches = (index.typesByName.get(normalizeTypeName(word)) || []).sort(
    (a, b) =>
      scoreCandidate(b.project, b.namespace, b.file.path, pf, index) -
      scoreCandidate(a.project, a.namespace, a.file.path, pf, index)
  );
  if (typeMatches.length > 0) {
    return {
      symbolName: word,
      targets: dedupeTargets(
        typeMatches.map(t =>
          toImplementationItem({
            name: t.name,
            kind: t.isInterface ? 'interface' : 'class',
            file: t.file,
            line: t.line,
            column: t.column,
            preview: t.preview,
            containerName: t.namespace
          })
        )
      )
    };
  }

  // 4. Local parameter / field / property usage (`_service`, `repo`, etc.)
  if (chain.length === 1) {
    // Check method params first
    if (enclosingMethod) {
      const param = enclosingMethod.params.find(p => p.name === word);
      if (param && param.line !== line) {
        return {
          symbolName: `${word} (${param.type})`,
          targets: [
            toImplementationItem({
              name: word,
              kind: 'property',
              file: currentFile,
              line: param.line,
              column: param.column,
              preview: `${param.type} ${param.name}`,
              containerName: enclosingType?.name
            })
          ]
        };
      }
    }

    // Check class fields/properties (including inherited base class fields/properties!)
    if (enclosingType) {
      const member = findMemberOnTypeHierarchy(enclosingType.name, word, index);
      if (member) {
        // If already standing on the field declaration itself, jump to the field's Type declaration!
        if (member.file.path === currentFile.path && member.line === line) {
          const fieldTypeName = normalizeTypeName(member.returnType);
          const fieldTypes = index.typesByName.get(fieldTypeName) || [];
          if (fieldTypes.length > 0) {
            return {
              symbolName: `${word} (${fieldTypeName})`,
              targets: dedupeTargets(
                fieldTypes.map(t =>
                  toImplementationItem({
                    name: t.name,
                    kind: t.isInterface ? 'interface' : 'class',
                    file: t.file,
                    line: t.line,
                    column: t.column,
                    preview: t.preview,
                    containerName: t.namespace
                  })
                )
              )
            };
          }
        }
        return {
          symbolName: `${member.ownerTypeName}.${word}`,
          targets: [
            toImplementationItem({
              name: `${member.ownerTypeName}.${member.name}`,
              kind: member.kind === 'property' || member.kind === 'field' ? 'property' : 'method',
              file: member.file,
              line: member.line,
              column: member.column,
              preview: member.preview,
              containerName: member.ownerNamespace
            })
          ]
        };
      }
    }
  }

  // 5. Fallback: any method / property matching across solution (preferring interface declarations + referenced projects)
  const memberMatches = [...(index.allMethodsByName.get(word) || [])].sort((a, b) => {
    const scoreA =
      scoreCandidate(a.project, a.ownerNamespace, a.file.path, pf, index) + (a.ownerIsInterface ? 12 : 0);
    const scoreB =
      scoreCandidate(b.project, b.ownerNamespace, b.file.path, pf, index) + (b.ownerIsInterface ? 12 : 0);
    return scoreB - scoreA;
  });

  if (memberMatches.length > 0) {
    return {
      symbolName: word,
      targets: dedupeTargets(
        memberMatches.map(m =>
          toImplementationItem({
            name: `${m.ownerTypeName}.${m.name}`,
            kind: m.kind === 'property' || m.kind === 'field' ? 'property' : 'method',
            file: m.file,
            line: m.line,
            column: m.column,
            preview: m.preview,
            containerName: m.ownerNamespace
          })
        )
      )
    };
  }

  return { symbolName: word, targets: [] };
}

/**
 * Resolve concrete implementations of an interface/base type, optionally targeting a specific member inside those classes.
 */
function findConcreteImplementationsOfType(
  baseTypeName: string,
  memberName: string | undefined,
  index: SolutionSemanticIndex,
  sourceFileInfo: ParsedFileInfo | undefined
): ImplementationItem[] {
  const cleanBase = normalizeTypeName(baseTypeName);
  const directImpls = index.implementationsByBase.get(cleanBase) || [];
  const concreteTypes = directImpls.filter(t => !t.isInterface);

  // Prefer non-abstract classes if any exist
  const nonAbstract = concreteTypes.filter(t => !t.isAbstract);
  const chosenTypes = (nonAbstract.length > 0 ? nonAbstract : concreteTypes).sort(
    (a, b) =>
      scoreCandidate(b.project, b.namespace, b.file.path, sourceFileInfo, index) -
      scoreCandidate(a.project, a.namespace, a.file.path, sourceFileInfo, index)
  );

  const results: ImplementationItem[] = [];

  for (const implClass of chosenTypes) {
    if (memberName) {
      // Find member directly on this concrete class OR on its base class (e.g. BaseRepository<T>.GetByIdAsync)
      const member = findMemberOnTypeHierarchy(implClass.name, memberName, index);
      if (member && !member.ownerIsInterface) {
        results.push(
          toImplementationItem({
            name: `${member.ownerTypeName}.${member.name}`,
            kind: member.kind === 'property' || member.kind === 'field' ? 'property' : 'method',
            file: member.file,
            line: member.line,
            column: member.column,
            preview: member.preview,
            containerName: member.ownerNamespace
          })
        );
        continue;
      }
    }

    // Class-level target (or member inherited via generic framework)
    results.push(
      toImplementationItem({
        name: implClass.name,
        kind: 'class',
        file: implClass.file,
        line: implClass.line,
        column: implClass.column,
        preview: implClass.preview,
        containerName: implClass.namespace
      })
    );
  }

  return dedupeTargets(results);
}

/**
 * Go to Implementation (⌥⌘B, Cmd+F12, Context Menu -> Go to Implementation)
 * Resolves transitive inheritance, project dependencies, DI registrations, MediatR handlers, and multi-line signatures!
 */
export function resolveCSharpImplementations(
  solution: SolutionFile,
  currentFile: SolutionFileItem,
  line: number,
  column: number,
  explicitWord?: string
): NavigationResult {
  const content = currentFile.content || '';
  const { word, chain, isConstructorCall } = extractSymbolContext(content, line, column, explicitWord);
  if (!word) return { symbolName: '', targets: [] };

  const index = getOrBuildSolutionIndex(solution);
  const pf = index.files.find(f => f.file.path === currentFile.path);
  const { enclosingType, enclosingMethod, cursorOffset } = findEnclosingContext(pf, line, column);

  // Case 1: Dotted call `_service.GetOrderAsync` or `_uow.Orders.GetByIdAsync`
  if (chain.length >= 2) {
    const receiverChain = chain.slice(0, -1);
    const receiverRawType = resolveChainTargetType(receiverChain, pf, enclosingType, enclosingMethod, cursorOffset, index);
    if (receiverRawType) {
      const receiverTypeName = normalizeTypeName(receiverRawType);
      const impls = findConcreteImplementationsOfType(receiverTypeName, word, index, pf);
      if (impls.length > 0) {
        return { symbolName: `${receiverTypeName}.${word}`, targets: impls };
      }

      // If receiver is already a concrete class, find overrides or jump to concrete member directly
      const member = findMemberOnTypeHierarchy(receiverTypeName, word, index);
      if (member) {
        return {
          symbolName: `${receiverTypeName}.${word}`,
          targets: [
            toImplementationItem({
              name: `${member.ownerTypeName}.${member.name}`,
              kind: member.kind === 'property' || member.kind === 'field' ? 'property' : 'method',
              file: member.file,
              line: member.line,
              column: member.column,
              preview: member.preview,
              containerName: member.ownerNamespace
            })
          ]
        };
      }
    }
  }

  // Case 2: MediatR / CQRS Command or Query (`new CreateOrderCommand(...)` or standing on `CreateOrderCommand`)
  const cleanWord = normalizeTypeName(word);
  const handlers = index.requestHandlerByRequest.get(cleanWord);
  if (handlers && handlers.length > 0 && (isConstructorCall || !(index.implementationsByBase.get(cleanWord)?.length))) {
    const sortedHandlers = [...handlers].sort(
      (a, b) =>
        scoreCandidate(b.project, b.namespace, b.file.path, pf, index) -
        scoreCandidate(a.project, a.namespace, a.file.path, pf, index)
    );
    return {
      symbolName: `${cleanWord} Handlers`,
      targets: dedupeTargets(
        sortedHandlers.map(h => {
          const handleMethod = h.members.find(m => m.name === 'Handle' || m.name === 'HandleAsync');
          return handleMethod
            ? toImplementationItem({
                name: `${h.name}.${handleMethod.name}`,
                kind: 'method',
                file: handleMethod.file,
                line: handleMethod.line,
                column: handleMethod.column,
                preview: handleMethod.preview,
                containerName: h.namespace
              })
            : toImplementationItem({
                name: h.name,
                kind: 'class',
                file: h.file,
                line: h.line,
                column: h.column,
                preview: h.preview,
                containerName: h.namespace
              });
        })
      )
    };
  }

  // Case 3: Cursor is on an interface or base class name (`IOrderService`, `BaseEntity`)
  const directTypeImpls = findConcreteImplementationsOfType(cleanWord, undefined, index, pf);
  if (directTypeImpls.length > 0) {
    return { symbolName: cleanWord, targets: directTypeImpls };
  }

  // Case 4: Cursor is on a local/field/parameter name whose type is an interface/base class (e.g. `_orderService`)
  if (chain.length === 1) {
    const varRawType = resolveIdentifierType(word, pf, enclosingType, enclosingMethod, cursorOffset, index);
    if (varRawType) {
      const varTypeName = normalizeTypeName(varRawType);
      const varImpls = findConcreteImplementationsOfType(varTypeName, undefined, index, pf);
      if (varImpls.length > 0) {
        return { symbolName: `${varTypeName} (${word})`, targets: varImpls };
      }
    }
  }

  // Case 5: Cursor is on an interface method declaration OR inside a class calling an inherited/interface method (`GetUserById`)
  if (enclosingType) {
    if (enclosingType.isInterface || enclosingType.isAbstract) {
      const impls = findConcreteImplementationsOfType(enclosingType.name, word, index, pf);
      if (impls.length > 0) {
        return { symbolName: `${enclosingType.name}.${word}`, targets: impls };
      }
    } else {
      // Check if word matches a method on one of enclosingType's base interfaces/classes
      for (const base of enclosingType.baseTypes) {
        const impls = findConcreteImplementationsOfType(base, word, index, pf);
        if (impls.length > 0) {
          return { symbolName: `${base}.${word}`, targets: impls };
        }
      }
    }
  }

  // Case 6: Cross-solution method lookup — find any interface owning `word` -> map to its concrete implementations, OR concrete methods matching `word`
  const matchingMethods = index.allMethodsByName.get(word) || [];
  const interfaceOwners = [...new Set(matchingMethods.filter(m => m.ownerIsInterface).map(m => m.ownerTypeName))];
  if (interfaceOwners.length > 0) {
    const allTargets: ImplementationItem[] = [];
    for (const iface of interfaceOwners) {
      allTargets.push(...findConcreteImplementationsOfType(iface, word, index, pf));
    }
    if (allTargets.length > 0) {
      return { symbolName: word, targets: dedupeTargets(allTargets) };
    }
  }

  const concreteMethods = matchingMethods
    .filter(m => !m.ownerIsInterface)
    .sort(
      (a, b) =>
        scoreCandidate(b.project, b.ownerNamespace, b.file.path, pf, index) -
        scoreCandidate(a.project, a.ownerNamespace, a.file.path, pf, index)
    );
  if (concreteMethods.length > 0) {
    return {
      symbolName: word,
      targets: dedupeTargets(
        concreteMethods.map(m =>
          toImplementationItem({
            name: `${m.ownerTypeName}.${m.name}`,
            kind: m.kind === 'property' || m.kind === 'field' ? 'property' : 'method',
            file: m.file,
            line: m.line,
            column: m.column,
            preview: m.preview,
            containerName: m.ownerNamespace
          })
        )
      )
    };
  }

  // Case 7: Concrete class itself (fallback if no derived classes)
  const selfTypes = index.typesByName.get(cleanWord) || [];
  if (selfTypes.length > 0) {
    return {
      symbolName: cleanWord,
      targets: dedupeTargets(
        selfTypes.map(t =>
          toImplementationItem({
            name: t.name,
            kind: t.isInterface ? 'interface' : 'class',
            file: t.file,
            line: t.line,
            column: t.column,
            preview: t.preview,
            containerName: t.namespace
          })
        )
      )
    };
  }

  return { symbolName: word, targets: [] };
}

/**
 * Find Usages across all files in the solution (⌥F7, ⇧F12)
 */
export function resolveCSharpUsages(
  solution: SolutionFile,
  currentFile: SolutionFileItem,
  line: number,
  column: number,
  explicitWord?: string
): { symbolName: string; references: ReferenceItem[] } {
  const content = currentFile.content || '';
  const { word } = extractSymbolContext(content, line, column, explicitWord);
  if (!word) return { symbolName: '', references: [] };

  const references: ReferenceItem[] = [];
  const escaped = word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const regex = new RegExp(`\\b${escaped}\\b`, 'g');

  const files = getAllSolutionFiles(solution).filter(f => f.file.extension === '.cs');
  for (const { file, lines } of files) {
    for (let i = 0; i < lines.length; i++) {
      regex.lastIndex = 0;
      let match: RegExpExecArray | null;
      while ((match = regex.exec(lines[i])) !== null) {
        references.push({
          file: file.path,
          line: i + 1,
          column: match.index + 1,
          preview: lines[i].trim()
        });
        if (references.length >= 300) {
          return { symbolName: word, references };
        }
      }
    }
  }

  return { symbolName: word, references };
}

/**
 * Search plain text / symbols across all files in the solution (⌘⇧F)
 */
export function searchInSolution(
  solution: SolutionFile,
  query: string
): ReferenceItem[] {
  const q = query.trim().toLowerCase();
  if (!q) return [];

  const results: ReferenceItem[] = [];
  const files = getAllSolutionFiles(solution);
  for (const { file, lines } of files) {
    for (let i = 0; i < lines.length; i++) {
      const idx = lines[i].toLowerCase().indexOf(q);
      if (idx !== -1) {
        results.push({
          file: file.path,
          line: i + 1,
          column: idx + 1,
          preview: lines[i].trim()
        });
        if (results.length >= 200) return results;
      }
    }
  }
  return results;
}

export interface CSharpCompletionEntry {
  label: string;
  kind: 'method' | 'property' | 'class' | 'interface' | 'field';
  detail: string;
  insertText: string;
  documentation?: string;
}

function collectMembersOnTypeHierarchy(
  typeName: string,
  index: SolutionSemanticIndex,
  visited = new Set<string>(),
  out: ParsedMember[] = []
): ParsedMember[] {
  const clean = normalizeTypeName(typeName);
  if (!clean || visited.has(clean)) return out;
  visited.add(clean);

  const defs = index.typesByName.get(clean) || [];
  for (const t of defs) {
    for (const m of t.members) {
      if (!out.some(x => x.name === m.name && x.kind === m.kind)) {
        out.push(m);
      }
    }
    for (const base of t.baseTypes) {
      collectMembersOnTypeHierarchy(base, index, visited, out);
    }
  }
  return out;
}

/**
 * Provide C# IntelliSense / Auto-Completion after `.` or for solution types.
 */
export function getCSharpCompletions(
  solution: SolutionFile,
  currentFile: SolutionFileItem,
  line: number,
  column: number
): CSharpCompletionEntry[] {
  const content = currentFile.content || '';
  const index = getOrBuildSolutionIndex(solution);
  const pf = index.files.find(f => f.file.path === currentFile.path);
  const { enclosingType, enclosingMethod, cursorOffset } = findEnclosingContext(pf, line, column);

  const lineText = (content.split('\n')[Math.max(0, line - 1)] || '').slice(0, Math.max(0, column - 1));
  const dotMatch = lineText.match(/([A-Za-z_][A-Za-z0-9_.\(\)<>\?]*)\.\s*([A-Za-z0-9_]*)$/);

  // 1. Member completion after `<receiver>.`
  if (dotMatch) {
    const rawChain = dotMatch[1]
      .replace(/\([^)]*\)/g, '')
      .replace(/<[^>]*>/g, '')
      .replace(/\?/g, '')
      .split('.')
      .filter(Boolean);

    const targetType = resolveChainTargetType(
      rawChain,
      pf,
      enclosingType,
      enclosingMethod,
      cursorOffset,
      index
    );

    if (targetType) {
      const members = collectMembersOnTypeHierarchy(targetType, index);
      return members
        .filter(m => m.kind !== 'ctor')
        .map(m => ({
          label: m.name,
          kind: m.kind === 'method' ? 'method' : m.kind === 'property' ? 'property' : 'field',
          detail:
            m.kind === 'method'
              ? `${m.returnType} ${m.name}(${m.params.map(p => `${p.type} ${p.name}`).join(', ')})`
              : `${m.returnType} ${m.name}`,
          insertText: m.kind === 'method' ? `${m.name}(${m.params.length > 0 ? '' : ')'}` : m.name,
          documentation: `${m.ownerNamespace}.${m.ownerTypeName} (${m.project.name})`
        }));
    }
  }

  // 2. General completion: enclosing class members + all indexed solution types
  const entries: CSharpCompletionEntry[] = [];
  const seen = new Set<string>();

  if (enclosingType) {
    for (const m of collectMembersOnTypeHierarchy(enclosingType.name, index)) {
      if (!seen.has(m.name) && m.kind !== 'ctor') {
        seen.add(m.name);
        entries.push({
          label: m.name,
          kind: m.kind === 'method' ? 'method' : m.kind === 'property' ? 'property' : 'field',
          detail: `${m.returnType} ${m.name}`,
          insertText: m.name,
          documentation: `${m.ownerTypeName} member`
        });
      }
    }
  }

  for (const [typeName, defs] of index.typesByName.entries()) {
    if (!seen.has(typeName)) {
      seen.add(typeName);
      const t = defs[0];
      entries.push({
        label: typeName,
        kind: t.isInterface ? 'interface' : 'class',
        detail: `${t.kind} ${t.namespace}.${t.name}`,
        insertText: typeName,
        documentation: `Project: ${t.project.name}`
      });
    }
    if (entries.length >= 250) break;
  }

  return entries;
}

/**
 * Provide rich Hover Quick-Docs for C# symbols, showing exact type, project, and implementations.
 */
export function getCSharpHoverInfo(
  solution: SolutionFile,
  currentFile: SolutionFileItem,
  line: number,
  column: number,
  explicitWord?: string
): { title: string; subtitle: string; details: string[] } | null {
  const def = resolveCSharpDefinition(solution, currentFile, line, column, explicitWord);
  const impl = resolveCSharpImplementations(solution, currentFile, line, column, explicitWord);

  if (def.targets.length === 0 && impl.targets.length === 0) return null;

  const primary = def.targets[0] || impl.targets[0];
  const details: string[] = [];
  if (primary.containerName) {
    details.push(`Namespace: \`${primary.containerName}\``);
  }
  details.push(`Declared in: \`${primary.file.split('/').pop()}:${primary.line}\``);

  if (impl.targets.length > 0) {
    const implNames = impl.targets.slice(0, 4).map(t => `\`${t.name}\` (${t.file.split('/').pop()}:${t.line})`);
    details.push(`Implementations (${impl.targets.length}): ${implNames.join(', ')}`);
  }

  return {
    title: primary.preview,
    subtitle: `${primary.kind.toUpperCase()} • ${primary.name}`,
    details
  };
}

export interface FileOutlineSymbol {
  name: string;
  kind: 'class' | 'interface' | 'method' | 'property';
  line: number;
  column: number;
  containerName: string;
}

/**
 * Extract File Structure / Outline symbols for editor Breadcrumbs & Structure jump dropdown.
 */
export function getFileOutlineSymbols(
  solution: SolutionFile,
  file: SolutionFileItem
): FileOutlineSymbol[] {
  if (file.extension !== '.cs' || !file.content) return [];
  const index = getOrBuildSolutionIndex(solution);
  const pf = index.files.find(f => f.file.path === file.path);
  if (!pf) return [];

  const out: FileOutlineSymbol[] = [];
  for (const t of pf.types) {
    out.push({
      name: t.name,
      kind: t.isInterface ? 'interface' : 'class',
      line: t.line,
      column: t.column,
      containerName: t.namespace
    });
    for (const m of t.members) {
      if (m.kind === 'method' || m.kind === 'property' || m.kind === 'ctor') {
        out.push({
          name: m.kind === 'ctor' ? `${m.name}()` : m.kind === 'method' ? `${m.name}()` : m.name,
          kind: m.kind === 'property' ? 'property' : 'method',
          line: m.line,
          column: m.column,
          containerName: t.name
        });
      }
    }
  }
  return out;
}

/**
 * Discover real xUnit / NUnit / MSTest unit tests across all projects in the active solution.
 */
export function discoverSolutionTests(solution: SolutionFile): TestItem[] {
  const index = getOrBuildSolutionIndex(solution);
  const discovered: TestItem[] = [];

  for (const pf of index.files) {
    const isTestAttrRegex = /^\s*\[(?:Fact|Theory|Test|TestMethod|TestCase)\b/m;
    if (!isTestAttrRegex.test(pf.original) && pf.project.projectType !== 'test') continue;

    for (const t of pf.types) {
      for (const m of t.members) {
        if (m.kind !== 'method') continue;
        // Look at 6 lines above method declaration for [Fact] / [Theory] / [Test] / [TestMethod]
        const startCheck = Math.max(0, m.line - 7);
        const headerBlock = pf.lines.slice(startCheck, Math.max(0, m.line - 1)).join('\n');
        if (/\[(?:Fact|Theory|Test|TestMethod|TestCase)\b/.test(headerBlock)) {
          const framework: TestItem['framework'] = /\[(?:Fact|Theory)\b/.test(headerBlock)
            ? 'xUnit'
            : /\[(?:Test|TestCase)\b/.test(headerBlock)
              ? 'NUnit'
              : /\[TestMethod\b/.test(headerBlock)
                ? 'MSTest'
                : 'Unknown';

          const skipMatch =
            headerBlock.match(/Skip\s*=\s*"([^"]+)"/) ||
            headerBlock.match(/\[Ignore\(\s*"([^"]+)"/);

          discovered.push({
            id: `test-${pf.file.path}-${m.line}`,
            projectName: pf.project.name,
            namespace: t.namespace,
            className: t.name,
            methodName: m.name,
            fullName: t.namespace ? `${t.namespace}.${t.name}.${m.name}` : `${t.name}.${m.name}`,
            status: 'idle',
            filePath: pf.file.path,
            line: m.line,
            framework,
            ...(skipMatch ? { skipReason: skipMatch[1] } : {})
          });
        }
      }
    }
  }

  return discovered;
}

