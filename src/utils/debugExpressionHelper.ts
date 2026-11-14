import type { VariableItem } from '../types/minirider';

const CSHARP_KEYWORDS = new Set([
  'abstract', 'as', 'async', 'await', 'base', 'bool', 'break', 'byte', 'case', 'catch',
  'char', 'checked', 'class', 'const', 'continue', 'decimal', 'default', 'delegate', 'do',
  'double', 'else', 'enum', 'event', 'explicit', 'extern', 'false', 'finally', 'fixed',
  'float', 'for', 'foreach', 'goto', 'if', 'implicit', 'in', 'int', 'interface', 'internal',
  'is', 'lock', 'long', 'namespace', 'new', 'null', 'object', 'operator', 'out', 'override',
  'params', 'private', 'protected', 'public', 'readonly', 'record', 'ref', 'return', 'sbyte',
  'sealed', 'short', 'sizeof', 'stackalloc', 'static', 'string', 'struct', 'switch', 'throw',
  'true', 'try', 'typeof', 'uint', 'ulong', 'unchecked', 'unsafe', 'ushort', 'using',
  'var', 'virtual', 'void', 'volatile', 'where', 'while', 'yield', 'get', 'set', 'init',
  'partial', 'required', 'scoped', 'Task'
]);

export type ConversionFormatId =
  | 'raw'
  | 'json-pretty'
  | 'json-compact'
  | 'string'
  | 'tostring'
  | 'int'
  | 'long'
  | 'double'
  | 'decimal'
  | 'bool'
  | 'hex';

/**
 * Extracts either the non-empty user selection or the C# variable/member expression
 * ending at `column` (1-indexed) on `lineContent`.
 */
export function extractCSharpExpressionAtPosition(
  lineContent: string,
  column: number,
  selectedText?: string
): string | null {
  const trimmedSel = (selectedText || '').trim();
  if (trimmedSel && !trimmedSel.includes('\n') && trimmedSel.length <= 180) {
    if (!CSHARP_KEYWORDS.has(trimmedSel)) {
      return trimmedSel;
    }
    return null;
  }

  if (!lineContent) return null;
  const idx = Math.max(0, Math.min(column - 1, lineContent.length - 1));

  const isIdentChar = (ch: string) => /[A-Za-z0-9_@]/.test(ch);
  let cursor = idx;
  if (!isIdentChar(lineContent[cursor])) {
    if (cursor > 0 && isIdentChar(lineContent[cursor - 1])) {
      cursor--;
    } else {
      return null;
    }
  }

  let end = cursor;
  while (end + 1 < lineContent.length && isIdentChar(lineContent[end + 1])) {
    end++;
  }

  let wordStart = cursor;
  while (wordStart > 0 && isIdentChar(lineContent[wordStart - 1])) {
    wordStart--;
  }

  const hoveredIdent = lineContent.slice(wordStart, end + 1);
  if (!hoveredIdent || /^\d+$/.test(hoveredIdent) || CSHARP_KEYWORDS.has(hoveredIdent)) {
    return null;
  }

  let chainStart = wordStart;
  let parenDepth = 0;
  let bracketDepth = 0;
  for (let i = wordStart - 1; i >= 0; i--) {
    const ch = lineContent[i];
    if (ch === ')') {
      parenDepth++;
      chainStart = i;
    } else if (ch === '(') {
      if (parenDepth === 0) break;
      parenDepth--;
      chainStart = i;
    } else if (ch === ']') {
      bracketDepth++;
      chainStart = i;
    } else if (ch === '[') {
      if (bracketDepth === 0) break;
      bracketDepth--;
      chainStart = i;
    } else if (parenDepth > 0 || bracketDepth > 0) {
      chainStart = i;
    } else if (/[A-Za-z0-9_@.?]/.test(ch)) {
      if (ch === '?' && lineContent[i + 1] !== '.') {
        break;
      }
      chainStart = i;
    } else {
      break;
    }
  }

  const expr = lineContent.slice(chainStart, end + 1).replace(/^[.?]+/, '').trim();
  if (!expr || CSHARP_KEYWORDS.has(expr)) {
    return null;
  }
  return expr;
}

export interface EvaluatedDebugValue {
  success: boolean;
  expression: string;
  result: string;
  type?: string;
  variablesReference?: number;
  children?: VariableItem[];
}

export function unquoteCSharpString(raw: string): string {
  const s = (raw || '').trim();
  if (s.length >= 2 && s.startsWith('"') && s.endsWith('"')) {
    return s
      .slice(1, -1)
      .replace(/\\"/g, '"')
      .replace(/\\n/g, '\n')
      .replace(/\\r/g, '\r')
      .replace(/\\t/g, '\t')
      .replace(/\\\\/g, '\\');
  }
  if (s.length >= 3 && s.startsWith('@"') && s.endsWith('"')) {
    return s.slice(2, -1).replace(/""/g, '"');
  }
  return s;
}

export function parseScalarValue(rawResult: string, typeHint?: string): any {
  const s = (rawResult || '').trim();
  if (!s || s === 'null' || s === 'Nothing') return null;
  if (s === 'true' || s === 'True') return true;
  if (s === 'false' || s === 'False') return false;

  if (
    (s.startsWith('"') && s.endsWith('"')) ||
    (s.startsWith('@"') && s.endsWith('"'))
  ) {
    return unquoteCSharpString(s);
  }

  const lowerType = (typeHint || '').toLowerCase();
  if (
    lowerType.includes('int') ||
    lowerType.includes('long') ||
    lowerType.includes('double') ||
    lowerType.includes('float') ||
    lowerType.includes('decimal') ||
    lowerType.includes('byte') ||
    lowerType.includes('short') ||
    /^-?\d+(?:\.\d+)?$/.test(s)
  ) {
    const num = Number(s);
    if (!Number.isNaN(num)) return num;
  }

  return s;
}

const SKIPPED_DAP_META_NAMES = new Set([
  'Static members',
  'Non-Public members',
  'Raw View',
  'Results View'
]);

/**
 * Recursively reconstructs a C# runtime object / DAP variable tree into a clean JSON-serializable JS value.
 */
export async function variablesToJsonObject(
  node: Pick<EvaluatedDebugValue, 'result' | 'type' | 'variablesReference' | 'children'>,
  expandFn?: (variablesReference: number) => Promise<VariableItem[]>,
  depth = 0
): Promise<any> {
  if (!node) return null;
  const rawResult = (node.result || '').trim();
  if (rawResult === 'null' || rawResult === 'Nothing') return null;

  let children = node.children;
  if ((!children || children.length === 0) && node.variablesReference && node.variablesReference > 0 && expandFn && depth < 4) {
    try {
      children = await expandFn(node.variablesReference);
    } catch {
      children = undefined;
    }
  }

  if (!children || children.length === 0) {
    return parseScalarValue(rawResult, node.type);
  }

  // Filter out debugger pseudo-groups unless they are the only thing present
  const meaningful = children.filter(c => !SKIPPED_DAP_META_NAMES.has(c.name));
  if (meaningful.length === 0) {
    return parseScalarValue(rawResult, node.type);
  }

  // Detect arrays / IEnumerable indexed items ([0], [1], ...)
  const indexedChildren = meaningful.filter(c => /^\[\d+\]$/.test(c.name));
  if (indexedChildren.length > 0 && indexedChildren.length >= meaningful.filter(c => c.name !== 'Count' && c.name !== 'Length' && c.name !== 'Capacity').length) {
    const arr = [];
    for (const item of indexedChildren.slice(0, 100)) {
      arr.push(await variablesToJsonObject({
        result: item.value,
        type: item.type,
        variablesReference: item.variablesReference,
        children: item.children
      }, expandFn, depth + 1));
    }
    return arr;
  }

  const obj: Record<string, any> = {};
  for (const child of meaningful.slice(0, 120)) {
    // Strip private backing field wrapper e.g. `<Name>k__BackingField` or `base`
    if (child.name.endsWith('k__BackingField')) continue;
    obj[child.name] = await variablesToJsonObject({
      result: child.value,
      type: child.type,
      variablesReference: child.variablesReference,
      children: child.children
    }, expandFn, depth + 1);
  }
  return obj;
}

/**
 * Generates a real C# expression for netcoredbg runtime evaluation with explicit type conversion / JSON stringify.
 */
export function buildCSharpConversionExpression(expr: string, format: ConversionFormatId): string {
  const clean = (expr || '').trim();
  if (!clean || format === 'raw') return clean;

  switch (format) {
    case 'json-pretty':
      return `System.Text.Json.JsonSerializer.Serialize((${clean}), new System.Text.Json.JsonSerializerOptions { WriteIndented = true })`;
    case 'json-compact':
      return `System.Text.Json.JsonSerializer.Serialize((${clean}))`;
    case 'string':
      return `((${clean}) == null ? null : (${clean}).ToString())`;
    case 'tostring':
      return `(${clean})?.ToString()`;
    case 'int':
      return `System.Convert.ToInt32(${clean})`;
    case 'long':
      return `System.Convert.ToInt64(${clean})`;
    case 'double':
      return `System.Convert.ToDouble(${clean})`;
    case 'decimal':
      return `System.Convert.ToDecimal(${clean})`;
    case 'bool':
      return `System.Convert.ToBoolean(${clean})`;
    case 'hex':
      return `"0x" + System.Convert.ToInt64(${clean}).ToString("X")`;
    default:
      return clean;
  }
}

/**
 * Converts an evaluated value locally using either its DAP variable tree or scalar value.
 */
export async function convertEvaluatedValueLocally(
  evalRes: EvaluatedDebugValue,
  format: ConversionFormatId,
  expandFn?: (variablesReference: number) => Promise<VariableItem[]>
): Promise<{ formatted: string; typeLabel: string }> {
  if (!evalRes.success) {
    return { formatted: evalRes.result, typeLabel: 'error' };
  }

  if (format === 'raw') {
    return { formatted: evalRes.result, typeLabel: evalRes.type || 'object' };
  }

  if (format === 'json-pretty' || format === 'json-compact') {
    const obj = await variablesToJsonObject(evalRes, expandFn, 0);
    return {
      formatted: format === 'json-pretty' ? JSON.stringify(obj, null, 2) : JSON.stringify(obj),
      typeLabel: 'json (string)'
    };
  }

  const scalar = parseScalarValue(evalRes.result, evalRes.type);
  switch (format) {
    case 'string': {
      if (scalar === null) return { formatted: 'null', typeLabel: 'string?' };
      return { formatted: JSON.stringify(String(scalar)), typeLabel: 'string' };
    }
    case 'tostring': {
      if (scalar === null) return { formatted: 'null', typeLabel: 'string?' };
      if ((evalRes.children && evalRes.children.length > 0) || (evalRes.variablesReference && evalRes.variablesReference > 0)) {
        const obj = await variablesToJsonObject(evalRes, expandFn, 0);
        return { formatted: JSON.stringify(obj), typeLabel: 'string' };
      }
      return { formatted: String(scalar), typeLabel: 'string' };
    }
    case 'int': {
      const n = typeof scalar === 'boolean' ? (scalar ? 1 : 0) : parseInt(String(scalar), 10);
      return Number.isNaN(n)
        ? { formatted: `Cannot convert '${evalRes.result}' to Int32`, typeLabel: 'error' }
        : { formatted: String(n), typeLabel: 'int' };
    }
    case 'long': {
      const n = typeof scalar === 'boolean' ? (scalar ? 1 : 0) : parseInt(String(scalar), 10);
      return Number.isNaN(n)
        ? { formatted: `Cannot convert '${evalRes.result}' to Int64`, typeLabel: 'error' }
        : { formatted: String(n), typeLabel: 'long' };
    }
    case 'double':
    case 'decimal': {
      const n = typeof scalar === 'boolean' ? (scalar ? 1 : 0) : Number(scalar);
      return Number.isNaN(n)
        ? { formatted: `Cannot convert '${evalRes.result}' to ${format}`, typeLabel: 'error' }
        : { formatted: String(n), typeLabel: format };
    }
    case 'bool': {
      if (scalar === null || scalar === 0 || scalar === '0' || String(scalar).toLowerCase() === 'false' || scalar === '') {
        return { formatted: 'false', typeLabel: 'bool' };
      }
      return { formatted: 'true', typeLabel: 'bool' };
    }
    case 'hex': {
      const n = parseInt(String(scalar), 10);
      return Number.isNaN(n)
        ? { formatted: `Cannot convert '${evalRes.result}' to Hex`, typeLabel: 'error' }
        : { formatted: `0x${(n >>> 0).toString(16).toUpperCase()}`, typeLabel: 'hex' };
    }
    default:
      return { formatted: evalRes.result, typeLabel: evalRes.type || 'object' };
  }
}

/**
 * Fallback evaluator for browser/sample debug sessions where no real netcoredbg process runs.
 */
export function evaluateSampleExpression(
  expression: string,
  variables: VariableItem[]
): EvaluatedDebugValue {
  const clean = expression.trim();
  if (!clean) {
    return { success: false, expression: clean, result: 'Empty expression' };
  }

  const eqNullMatch = clean.match(/^([A-Za-z_][A-Za-z0-9_.]*)\s*(==|!=)\s*null$/);
  if (eqNullMatch) {
    const inner = evaluateSampleExpression(eqNullMatch[1], variables);
    if (inner.success) {
      const isNull = inner.result.trim().toLowerCase() === 'null';
      const val = eqNullMatch[2] === '==' ? isNull : !isNull;
      return { success: true, expression: clean, result: String(val), type: 'bool' };
    }
  }

  const arithMatch = clean.match(/^([A-Za-z_][A-Za-z0-9_.]*)\s*([+\-*])\s*(-?\d+(?:\.\d+)?)$/);
  if (arithMatch) {
    const inner = evaluateSampleExpression(arithMatch[1], variables);
    const num = Number(inner.result);
    const rhs = Number(arithMatch[3]);
    if (inner.success && !Number.isNaN(num) && !Number.isNaN(rhs)) {
      const computed =
        arithMatch[2] === '+'
          ? num + rhs
          : arithMatch[2] === '-'
          ? num - rhs
          : num * rhs;
      return { success: true, expression: clean, result: String(computed), type: inner.type || 'int' };
    }
  }

  const parts = clean.replace(/\?\./g, '.').split('.').filter(Boolean);
  if (parts.length === 0) {
    return { success: false, expression: clean, result: 'Unavailable' };
  }

  let currentList: VariableItem[] | undefined = variables;
  let found: VariableItem | undefined;

  for (let i = 0; i < parts.length; i++) {
    const segment = parts[i];
    if (!currentList) {
      found = undefined;
      break;
    }
    found = currentList.find((v) => v.name === segment);
    if (!found && i === 0 && segment !== 'this') {
      const thisNode = variables.find((v) => v.name === 'this');
      if (thisNode?.children) {
        found = thisNode.children.find((c) => c.name === segment);
      }
    }
    if (!found) break;
    currentList = found.children;
  }

  if (found) {
    return {
      success: true,
      expression: clean,
      result: found.value,
      type: found.type,
      variablesReference: found.variablesReference,
      children: found.children
    };
  }

  return {
    success: false,
    expression: clean,
    result: `The name '${clean}' does not exist in the current context`
  };
}

export function updateSampleVariableValue(
  variables: VariableItem[],
  expression: string,
  newValue: string
): { updated: VariableItem[]; applied: boolean } {
  const clean = expression.trim();
  const parts = clean.replace(/\?\./g, '.').split('.').filter(Boolean);
  if (parts.length === 0) return { updated: variables, applied: false };

  let applied = false;

  const updateRec = (list: VariableItem[], segIdx: number): VariableItem[] =>
    list.map((v) => {
      if (v.name === parts[segIdx]) {
        if (segIdx === parts.length - 1) {
          applied = true;
          return { ...v, value: newValue };
        }
        if (v.children) {
          return { ...v, children: updateRec(v.children, segIdx + 1) };
        }
      }
      return v;
    });

  let next = updateRec(variables, 0);
  if (!applied && parts.length === 1) {
    next = next.map((v) => {
      if (v.name === 'this' && v.children) {
        const res = updateRec(v.children, 0);
        if (applied) return { ...v, children: res };
      }
      return v;
    });
  }

  return { updated: next, applied };
}
