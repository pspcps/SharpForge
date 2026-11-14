import { SolutionFile } from '../types/minirider';
import { getOrBuildSolutionIndex } from './csharpSymbolNavigator';

export const CSHARP_TOKEN_TYPES = [
  'namespace',     // 0
  'type',          // 1
  'class',         // 2
  'interface',     // 3
  'enum',          // 4
  'struct',        // 5
  'typeParameter', // 6
  'parameter',     // 7
  'variable',      // 8
  'property',      // 9
  'method',        // 10
  'keyword',       // 11 (control flow: if, return, await, foreach, try, catch)
  'decorator',     // 12 (attributes: [ApiController], [HttpGet], [Fact])
  'field'          // 13 (_service, _logger, private fields)
] as const;

export const CSHARP_TOKEN_MODIFIERS = ['declaration', 'readonly', 'static'] as const;

const TOKEN_TYPE_INDEX: Record<string, number> = Object.fromEntries(
  CSHARP_TOKEN_TYPES.map((t, i) => [t, i])
);

const CONTROL_FLOW_KEYWORDS = new Set([
  'if', 'else', 'switch', 'case', 'default', 'for', 'foreach', 'in',
  'while', 'do', 'break', 'continue', 'return', 'yield', 'await', 'async',
  'try', 'catch', 'finally', 'throw', 'when', 'goto'
]);

const OTHER_CSHARP_KEYWORDS = new Set([
  'abstract', 'as', 'base', 'bool', 'byte', 'char', 'checked', 'class',
  'const', 'decimal', 'delegate', 'double', 'enum', 'event', 'explicit',
  'extern', 'false', 'fixed', 'float', 'implicit', 'int', 'interface',
  'internal', 'is', 'lock', 'long', 'namespace', 'new', 'null', 'object',
  'operator', 'out', 'override', 'params', 'private', 'protected', 'public',
  'readonly', 'record', 'ref', 'required', 'sbyte', 'sealed', 'short',
  'sizeof', 'stackalloc', 'static', 'string', 'struct', 'this', 'true',
  'typeof', 'uint', 'ulong', 'unchecked', 'unsafe', 'ushort', 'using',
  'var', 'virtual', 'void', 'volatile', 'init', 'get', 'set', 'value',
  'global', 'partial', 'where', 'select', 'from', 'nameof', 'with', 'and', 'or', 'not'
]);

const KNOWN_BCL_INTERFACES = new Set([
  'IEnumerable', 'IQueryable', 'IList', 'ICollection', 'IDictionary',
  'IReadOnlyList', 'IReadOnlyCollection', 'IReadOnlyDictionary', 'IDisposable',
  'IAsyncDisposable', 'IActionResult', 'IResult', 'ILogger', 'IConfiguration',
  'IServiceCollection', 'IServiceProvider', 'IHost', 'IWebHostEnvironment',
  'IHostEnvironment', 'IMediator', 'ISender', 'IPublisher', 'IRequest',
  'IRequestHandler', 'INotification', 'INotificationHandler', 'IOptions',
  'IHttpClientFactory', 'IEquatable', 'IComparable', 'ITask', 'IEnumerator',
  'ICommandHandler', 'IQueryHandler', 'IUnitOfWork'
]);

const KNOWN_BCL_TYPES = new Set([
  'Task', 'ValueTask', 'CancellationToken', 'Guid', 'DateTime', 'DateTimeOffset',
  'TimeSpan', 'DateOnly', 'TimeOnly', 'List', 'Dictionary', 'HashSet', 'Queue',
  'Stack', 'Span', 'ReadOnlySpan', 'Memory', 'StringBuilder', 'Exception',
  'ArgumentException', 'ArgumentNullException', 'InvalidOperationException',
  'KeyNotFoundException', 'UnauthorizedAccessException', 'HttpClient',
  'HttpResponseMessage', 'HttpRequestMessage', 'JsonSerializer', 'JsonDocument',
  'ActionResult', 'ControllerBase', 'Controller', 'DbContext', 'DbSet',
  'WebApplication', 'ModelBuilder', 'Results', 'Assert', 'Console', 'Math',
  'Convert', 'Enum', 'Regex', 'Encoding', 'Path', 'File', 'Directory', 'Stream',
  'MemoryStream', 'Thread', 'CancellationTokenSource', 'ConcurrentDictionary',
  'HttpStatusCode', 'Claim', 'ClaimsPrincipal', 'CultureInfo'
]);

interface RawToken {
  line: number; // 0-based
  char: number; // 0-based
  length: number;
  type: number;
  modifiers: number;
}

export function buildCSharpSemanticTokens(
  code: string,
  solution?: SolutionFile,
  filePath?: string
): Uint32Array {
  if (!code) return new Uint32Array(0);

  const knownClasses = new Set<string>(KNOWN_BCL_TYPES);
  const knownInterfaces = new Set<string>(KNOWN_BCL_INTERFACES);
  const knownEnums = new Set<string>();
  const knownStructs = new Set<string>();
  const fileParams = new Set<string>();
  const fileFields = new Set<string>();

  if (solution) {
    const idx = getOrBuildSolutionIndex(solution);
    for (const [name, defs] of idx.typesByName.entries()) {
      const primary = defs[0];
      if (!primary) continue;
      if (primary.isInterface) knownInterfaces.add(name);
      else if (primary.kind === 'enum') knownEnums.add(name);
      else if (primary.kind === 'struct') knownStructs.add(name);
      else knownClasses.add(name);
    }

    if (filePath) {
      const pf = idx.files.find(f => f.file.path === filePath);
      if (pf) {
        for (const t of pf.types) {
          t.primaryCtorParams.forEach(p => fileParams.add(p.name));
          for (const m of t.members) {
            if (m.kind === 'field') fileFields.add(m.name);
            m.params.forEach(p => fileParams.add(p.name));
          }
        }
      }
    }
  }

  const lines = code.split('\n');
  const tokens: RawToken[] = [];
  let inBlockComment = false;

  for (let lineIdx = 0; lineIdx < lines.length; lineIdx++) {
    const line = lines[lineIdx];
    const len = line.length;
    let i = 0;

    // Check attribute line heuristic: `[Attr(...)]` at start of statement/member
    const trimmedLine = line.trim();
    const isAttributeLine =
      trimmedLine.startsWith('[') &&
      !trimmedLine.startsWith('[assembly:') &&
      /^\[\s*[A-Za-z_][A-Za-z0-9_.]*/.test(trimmedLine);

    while (i < len) {
      const ch = line[i];

      // Block comment handling
      if (inBlockComment) {
        const end = line.indexOf('*/', i);
        if (end === -1) {
          i = len;
          break;
        }
        inBlockComment = false;
        i = end + 2;
        continue;
      }

      if (ch === '/' && line[i + 1] === '*') {
        inBlockComment = true;
        i += 2;
        continue;
      }

      // Single-line comment
      if (ch === '/' && line[i + 1] === '/') {
        break;
      }

      // Char literal
      if (ch === "'") {
        i++;
        while (i < len) {
          if (line[i] === '\\') {
            i += 2;
          } else if (line[i] === "'") {
            i++;
            break;
          } else {
            i++;
          }
        }
        continue;
      }

      // String literals (regular, verbatim @"", interpolated $"")
      if (
        ch === '"' ||
        ((ch === '$' || ch === '@') && line[i + 1] === '"') ||
        (ch === '$' && line[i + 1] === '@' && line[i + 2] === '"') ||
        (ch === '@' && line[i + 1] === '$' && line[i + 2] === '"')
      ) {
        const isInterpolated =
          ch === '$' || (ch === '@' && line[i + 1] === '$');
        while (i < len && line[i] !== '"') i++;
        i++; // skip opening quote
        let braceDepth = 0;
        while (i < len) {
          const c = line[i];
          if (c === '\\') {
            i += 2;
            continue;
          }
          if (isInterpolated && c === '{') {
            if (line[i + 1] === '{') {
              i += 2;
              continue;
            }
            braceDepth++;
            i++;
            continue;
          }
          if (isInterpolated && c === '}' && braceDepth > 0) {
            braceDepth--;
            i++;
            continue;
          }
          if (c === '"' && braceDepth === 0) {
            i++;
            break;
          }
          i++;
        }
        continue;
      }

      // Identifier scanning
      if ((ch >= 'a' && ch <= 'z') || (ch >= 'A' && ch <= 'Z') || ch === '_') {
        const start = i;
        while (
          i < len &&
          ((line[i] >= 'a' && line[i] <= 'z') ||
            (line[i] >= 'A' && line[i] <= 'Z') ||
            (line[i] >= '0' && line[i] <= '9') ||
            line[i] === '_')
        ) {
          i++;
        }
        const word = line.slice(start, i);
        const before = line.slice(0, start).trimEnd();
        const after = line.slice(i).trimStart();

        let tokenType: string | null = null;
        let modifiers = 0;

        if (CONTROL_FLOW_KEYWORDS.has(word)) {
          tokenType = 'keyword';
        } else if (OTHER_CSHARP_KEYWORDS.has(word)) {
          // Let Monarch color standard modifiers/storage keywords cleanly
          continue;
        } else if (
          isAttributeLine &&
          before.endsWith('[') &&
          !trimmedLine.includes('=')
        ) {
          tokenType = 'decorator';
        } else if (
          /^(?:using|namespace)\s+(?:static\s+)?[A-Za-z0-9_.]*$/.test(before) ||
          (/^(?:using|namespace)\b/.test(trimmedLine) && after.startsWith('.'))
        ) {
          tokenType = 'namespace';
        } else if (
          /\b(?:class|record|struct|interface|enum)\s+$/.test(before)
        ) {
          modifiers = 1; // declaration
          if (/\binterface\s+$/.test(before)) tokenType = 'interface';
          else if (/\benum\s+$/.test(before)) tokenType = 'enum';
          else if (/\bstruct\s+$/.test(before)) tokenType = 'struct';
          else tokenType = 'class';
        } else if (knownInterfaces.has(word) || (/^I[A-Z][A-Za-z0-9_]+$/.test(word) && !after.startsWith('('))) {
          tokenType = 'interface';
        } else if (knownEnums.has(word)) {
          tokenType = 'enum';
        } else if (knownStructs.has(word)) {
          tokenType = 'struct';
        } else if (knownClasses.has(word)) {
          tokenType = 'class';
        } else if (after.startsWith('(') || /^<[^>\n]+>\s*\(/.test(after)) {
          // Constructor calls after `new Foo(...)` are classes
          if (/\bnew\s+(?:[A-Za-z0-9_]+\.)*$/.test(before)) {
            tokenType = /^I[A-Z]/.test(word) ? 'interface' : 'class';
          } else {
            tokenType = 'method';
          }
        } else if (word.startsWith('_') || fileFields.has(word)) {
          tokenType = 'field';
        } else if (before.endsWith('.') && /^[A-Z]/.test(word)) {
          tokenType = 'property';
        } else if (
          /^[A-Z][A-Za-z0-9_]*$/.test(word) &&
          (after.startsWith('<') ||
            after.startsWith('?') ||
            after.startsWith('[]') ||
            /^[a-z_][A-Za-z0-9_]*/.test(after) ||
            /\b(?:new|is|as|typeof|nameof)\s+$/.test(before) ||
            /[:<,]\s*$/.test(before))
        ) {
          tokenType = /^I[A-Z][A-Za-z0-9]+$/.test(word) ? 'interface' : 'class';
        } else if (fileParams.has(word)) {
          tokenType = 'parameter';
        } else if (/^[a-z][A-Za-z0-9_]*$/.test(word) && before.endsWith('.')) {
          tokenType = 'property';
        } else if (/^[A-Z][A-Za-z0-9_]*$/.test(word) && /\b(get|set|init)\b/.test(after)) {
          tokenType = 'property';
        }

        if (tokenType && TOKEN_TYPE_INDEX[tokenType] !== undefined) {
          tokens.push({
            line: lineIdx,
            char: start,
            length: word.length,
            type: TOKEN_TYPE_INDEX[tokenType],
            modifiers
          });
        }
        continue;
      }

      i++;
    }
  }

  // Delta-encode per LSP / Monaco SemanticTokens spec
  const data = new Uint32Array(tokens.length * 5);
  let prevLine = 0;
  let prevChar = 0;

  for (let idx = 0; idx < tokens.length; idx++) {
    const t = tokens[idx];
    const deltaLine = t.line - prevLine;
    const deltaChar = deltaLine === 0 ? t.char - prevChar : t.char;
    const offset = idx * 5;

    data[offset] = deltaLine;
    data[offset + 1] = deltaChar;
    data[offset + 2] = t.length;
    data[offset + 3] = t.type;
    data[offset + 4] = t.modifiers;

    prevLine = t.line;
    prevChar = t.char;
  }

  return data;
}
