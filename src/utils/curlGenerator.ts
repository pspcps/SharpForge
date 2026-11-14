import type { VariableItem } from '../types/minirider';
import {
  type EvaluatedDebugValue,
  unquoteCSharpString,
  variablesToJsonObject
} from './debugExpressionHelper';

export type HttpVerb = 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH' | 'HEAD';

export interface DetectedHttpCall {
  method: HttpVerb;
  methodCallName: string;
  urlExpr: string;
  payloadExpr?: string;
  authExpr?: string;
  rawStatement: string;
  line: number;
}

export interface GeneratedCurlResult {
  curlCommand: string;
  multilineCurlCommand: string;
  method: HttpVerb;
  resolvedUrl: string;
  queryParams: Record<string, string>;
  headers: Record<string, string>;
  bodyJson: string | null;
  warnings: string[];
}

function splitTopLevelArgs(argsText: string): string[] {
  const result: string[] = [];
  let paren = 0;
  let brace = 0;
  let bracket = 0;
  let angle = 0;
  let inString = false;
  let escapeNext = false;
  let start = 0;

  for (let i = 0; i < argsText.length; i++) {
    const ch = argsText[i];
    if (inString) {
      if (escapeNext) {
        escapeNext = false;
      } else if (ch === '\\') {
        escapeNext = true;
      } else if (ch === '"') {
        inString = false;
      }
      continue;
    }

    if (ch === '"') {
      inString = true;
    } else if (ch === '(') paren++;
    else if (ch === ')' && paren > 0) paren--;
    else if (ch === '{') brace++;
    else if (ch === '}' && brace > 0) brace--;
    else if (ch === '[') bracket++;
    else if (ch === ']' && bracket > 0) bracket--;
    else if (ch === '<') angle++;
    else if (ch === '>' && angle > 0) angle--;
    else if (ch === ',' && paren === 0 && brace === 0 && bracket === 0 && angle === 0) {
      const piece = argsText.slice(start, i).trim();
      if (piece) result.push(piece);
      start = i + 1;
    }
  }

  const last = argsText.slice(start).trim();
  if (last) result.push(last);
  return result;
}

function inferMethodFromCallName(methodName: string): HttpVerb | null {
  const lower = methodName.toLowerCase();
  if (lower.startsWith('get')) return 'GET';
  if (lower.startsWith('post')) return 'POST';
  if (lower.startsWith('put')) return 'PUT';
  if (lower.startsWith('delete') || lower.startsWith('remove')) return 'DELETE';
  if (lower.startsWith('patch')) return 'PATCH';
  if (lower.startsWith('head')) return 'HEAD';
  if (lower === 'sendasync' || lower === 'send' || lower === 'executeasync' || lower === 'execute') {
    return 'GET';
  }
  return null;
}

/**
 * Extracts a C# HTTP / REST API invocation on or immediately surrounding `lineNumber` (1-indexed).
 * Handles patterns like:
 *   return await _restApiAccessor.GetQuery<TrackPointsResponse>($"{_url}/v1/gps", request, authContext);
 *   await _httpClient.PostAsJsonAsync($"{_baseUrl}/orders", payload, ct);
 */
export function parseHttpCallAtLine(fileContent: string, lineNumber: number): DetectedHttpCall | null {
  if (!fileContent) return null;
  const lines = fileContent.split('\n');
  const idx = Math.max(0, Math.min(lines.length - 1, lineNumber - 1));

  // Gather multi-line statement window around cursor line (up to +-6 lines)
  let startIdx = idx;
  while (startIdx > Math.max(0, idx - 6)) {
    const prev = lines[startIdx - 1].trim();
    if (!prev || prev.endsWith(';') || prev.endsWith('{') || prev.endsWith('}')) {
      break;
    }
    startIdx--;
  }

  let endIdx = idx;
  while (endIdx < Math.min(lines.length - 1, idx + 8)) {
    if (lines[endIdx].includes(';')) break;
    endIdx++;
  }

  const windowText = lines.slice(startIdx, endIdx + 1).join('\n');

  const callRegex = /\.((?:Get|Post|Put|Delete|Patch|Head)(?:Query|Async|AsJsonAsync|JsonAsync|FromJsonAsync|StringAsync)?|SendAsync|Send|ExecuteAsync|Execute)\s*(?:<[^()]+>)?\s*\(/gi;
  let match: RegExpExecArray | null;
  let chosenMatch: { methodCallName: string; openParenIdx: number } | null = null;

  while ((match = callRegex.exec(windowText)) !== null) {
    chosenMatch = {
      methodCallName: match[1],
      openParenIdx: match.index + match[0].length - 1
    };
    break;
  }

  if (chosenMatch) {
    // Match closing paren for invocation
    let depth = 0;
    let inStr = false;
    let esc = false;
    let closeIdx = windowText.length - 1;
    for (let i = chosenMatch.openParenIdx; i < windowText.length; i++) {
      const c = windowText[i];
      if (inStr) {
        if (esc) esc = false;
        else if (c === '\\') esc = true;
        else if (c === '"') inStr = false;
        continue;
      }
      if (c === '"') inStr = true;
      else if (c === '(') depth++;
      else if (c === ')') {
        depth--;
        if (depth === 0) {
          closeIdx = i;
          break;
        }
      }
    }

    const rawArgs = windowText.slice(chosenMatch.openParenIdx + 1, closeIdx);
    const args = splitTopLevelArgs(rawArgs);
    let verb = inferMethodFromCallName(chosenMatch.methodCallName) || 'GET';

    // Check if explicit HttpMethod appears in args (e.g. HttpMethod.Post)
    const httpMethodArg = args.find(a => /HttpMethod\.(Get|Post|Put|Delete|Patch|Head)/i.test(a));
    if (httpMethodArg) {
      const m = httpMethodArg.match(/HttpMethod\.(Get|Post|Put|Delete|Patch|Head)/i);
      if (m) verb = m[1].toUpperCase() as HttpVerb;
    }

    const nonCancellationArgs = args.filter(
      a => !/CancellationToken|cancellationToken|^ct$/i.test(a.trim()) && !/^HttpMethod\./i.test(a.trim())
    );

    const urlExpr = nonCancellationArgs[0] || '';
    const payloadExpr = nonCancellationArgs[1];
    const authExpr = nonCancellationArgs[2];

    if (urlExpr) {
      return {
        method: verb,
        methodCallName: chosenMatch.methodCallName,
        urlExpr,
        payloadExpr,
        authExpr,
        rawStatement: windowText.trim(),
        line: lineNumber
      };
    }
  }

  // Fallback: detect ASP.NET Core [HttpGet("...")] attribute near current method
  for (let scan = idx; scan >= Math.max(0, idx - 12); scan--) {
    const attrMatch = lines[scan].match(/\[\s*Http(Get|Post|Put|Delete|Patch)\s*(?:\(\s*"([^"]*)"\s*\))?\s*\]/i);
    if (attrMatch) {
      const verb = attrMatch[1].toUpperCase() as HttpVerb;
      let classRoute = '';
      for (let k = scan; k >= 0; k--) {
        const rm = lines[k].match(/\[\s*Route\s*\(\s*"([^"]+)"\s*\)\s*\]/i);
        if (rm) {
          classRoute = rm[1];
          break;
        }
      }
      const actionRoute = attrMatch[2] || '';
      const combined = [classRoute.replace(/^\/+|\/+$/g, ''), actionRoute.replace(/^\/+|\/+$/g, '')]
        .filter(Boolean)
        .join('/');
      return {
        method: verb,
        methodCallName: `Http${attrMatch[1]}`,
        urlExpr: `"/${combined}"`,
        rawStatement: lines[scan].trim(),
        line: lineNumber
      };
    }
  }

  return null;
}

async function resolveCSharpStringExpression(
  expr: string,
  evaluateFn: (expression: string, context?: 'hover' | 'watch' | 'repl') => Promise<EvaluatedDebugValue>,
  fallbackBaseUrl?: string | null
): Promise<{ value: string; warnings: string[] }> {
  const clean = (expr || '').trim();
  const warnings: string[] = [];

  if (!clean) {
    return { value: fallbackBaseUrl || 'http://localhost:5000', warnings };
  }

  // 1. Interpolated string: $"{_url}/v1/gps?foo={bar}" or $@"{_url}/v1/gps"
  const interpMatch = clean.match(/^(?:\$@|@\$|\$)"([\s\S]*)"$/);
  if (interpMatch) {
    let template = interpMatch[1];
    const tokenRegex = /\{([^{}:]+)(?::[^}]+)?\}/g;
    const replacements: Array<{ token: string; resolved: string }> = [];
    let m: RegExpExecArray | null;

    while ((m = tokenRegex.exec(template)) !== null) {
      const innerExpr = m[1].trim();
      const evalRes = await evaluateFn(innerExpr, 'watch');
      if (evalRes.success && evalRes.result && evalRes.result !== 'null') {
        replacements.push({
          token: m[0],
          resolved: unquoteCSharpString(evalRes.result)
        });
      } else if (fallbackBaseUrl && /url|base/i.test(innerExpr)) {
        replacements.push({
          token: m[0],
          resolved: fallbackBaseUrl.replace(/\/$/, '')
        });
      } else {
        warnings.push(`Could not evaluate '${innerExpr}' in URL template`);
        replacements.push({
          token: m[0],
          resolved: `<${innerExpr}>`
        });
      }
    }

    for (const r of replacements) {
      template = template.replace(r.token, r.resolved);
    }
    return { value: template, warnings };
  }

  // 2. Plain string literal: "/v1/gps"
  if ((clean.startsWith('"') && clean.endsWith('"')) || (clean.startsWith('@"') && clean.endsWith('"'))) {
    return { value: unquoteCSharpString(clean), warnings };
  }

  // 3. String concatenation: _url + "/v1/gps"
  if (clean.includes('+')) {
    const parts = clean.split('+').map(p => p.trim()).filter(Boolean);
    let out = '';
    for (const part of parts) {
      const sub = await resolveCSharpStringExpression(part, evaluateFn, fallbackBaseUrl);
      out += sub.value;
      warnings.push(...sub.warnings);
    }
    return { value: out, warnings };
  }

  // 4. Variable / property / method argument expression (e.g. `url`, `_endpoint`)
  const directEval = await evaluateFn(clean, 'watch');
  if (directEval.success && directEval.result && directEval.result !== 'null') {
    return { value: unquoteCSharpString(directEval.result), warnings };
  }

  if (fallbackBaseUrl && /url|base|endpoint/i.test(clean)) {
    return { value: fallbackBaseUrl, warnings };
  }

  warnings.push(`Could not evaluate URL expression '${clean}'`);
  return { value: clean, warnings };
}

function appendQueryParams(url: string, data: any): { finalUrl: string; queryParams: Record<string, string> } {
  const queryParams: Record<string, string> = {};
  if (!data || typeof data !== 'object') {
    return { finalUrl: url, queryParams };
  }

  const pairs: string[] = [];
  const flatten = (obj: any, prefix = '') => {
    if (obj === null || obj === undefined) return;
    if (Array.isArray(obj)) {
      obj.forEach((item) => {
        if (item !== null && item !== undefined && typeof item !== 'object') {
          const key = prefix || 'item';
          queryParams[key] = String(item);
          pairs.push(`${encodeURIComponent(key)}=${encodeURIComponent(String(item))}`);
        }
      });
      return;
    }
    if (typeof obj === 'object') {
      for (const [k, v] of Object.entries(obj)) {
        if (v === null || v === undefined) continue;
        const propKey = prefix ? `${prefix}.${k}` : k;
        if (typeof v === 'object') {
          flatten(v, propKey);
        } else {
          queryParams[propKey] = String(v);
          pairs.push(`${encodeURIComponent(propKey)}=${encodeURIComponent(String(v))}`);
        }
      }
    }
  };

  flatten(data);
  if (pairs.length === 0) {
    return { finalUrl: url, queryParams };
  }

  const sep = url.includes('?') ? '&' : '?';
  return {
    finalUrl: `${url}${sep}${pairs.join('&')}`,
    queryParams
  };
}

function extractHeadersFromAuthObject(authObj: any): Record<string, string> {
  const headers: Record<string, string> = {};
  if (!authObj) return headers;

  if (typeof authObj === 'string') {
    if (authObj.startsWith('Bearer ') || authObj.startsWith('Basic ')) {
      headers['Authorization'] = authObj;
    } else if (authObj.length > 8 && authObj !== 'null') {
      headers['Authorization'] = `Bearer ${authObj}`;
    }
    return headers;
  }

  if (typeof authObj !== 'object') return headers;

  for (const [key, val] of Object.entries(authObj)) {
    if (val === null || val === undefined || val === '') continue;
    const lower = key.toLowerCase();

    if (typeof val === 'string' || typeof val === 'number') {
      const strVal = String(val);
      if (lower === 'authorization') {
        headers['Authorization'] = strVal;
      } else if (
        lower === 'token' ||
        lower === 'accesstoken' ||
        lower === 'bearertoken' ||
        lower === 'jwt' ||
        lower === 'jwttoken' ||
        lower === 'auth' ||
        lower === 'authtoken'
      ) {
        headers['Authorization'] = strVal.startsWith('Bearer ') ? strVal : `Bearer ${strVal}`;
      } else if (lower.includes('apikey') || lower === 'xapikey') {
        headers['X-Api-Key'] = strVal;
      } else if (lower.includes('tenant')) {
        headers['X-Tenant-Id'] = strVal;
      } else if (lower.includes('correlation')) {
        headers['X-Correlation-Id'] = strVal;
      } else if (lower.includes('useragent')) {
        headers['User-Agent'] = strVal;
      }
    } else if (lower === 'headers' && typeof val === 'object' && !Array.isArray(val)) {
      for (const [hk, hv] of Object.entries(val as Record<string, any>)) {
        if (hv !== null && hv !== undefined) {
          headers[hk] = String(hv);
        }
      }
    }
  }

  return headers;
}

function shellEscapeSingle(s: string): string {
  return `'${String(s).replace(/'/g, `'\\''`)}'`;
}

/**
 * Generates an executable cURL command from a detected HTTP call using live runtime values.
 */
export async function buildCurlFromCall(
  detected: DetectedHttpCall,
  evaluateFn: (expression: string, context?: 'hover' | 'watch' | 'repl') => Promise<EvaluatedDebugValue>,
  expandFn?: (variablesReference: number) => Promise<VariableItem[]>,
  fallbackBaseUrl?: string | null
): Promise<GeneratedCurlResult> {
  const warnings: string[] = [];

  // 1. Resolve URL string
  const urlRes = await resolveCSharpStringExpression(detected.urlExpr, evaluateFn, fallbackBaseUrl);
  let resolvedUrl = urlRes.value;
  warnings.push(...urlRes.warnings);

  if (resolvedUrl.startsWith('/') && fallbackBaseUrl) {
    resolvedUrl = `${fallbackBaseUrl.replace(/\/$/, '')}${resolvedUrl}`;
  }

  // 2. Resolve payload/request argument
  let queryParams: Record<string, string> = {};
  let bodyJson: string | null = null;
  const headers: Record<string, string> = {
    Accept: 'application/json'
  };

  if (detected.payloadExpr) {
    const cleanPayloadExpr = detected.payloadExpr.trim();
    if (cleanPayloadExpr !== 'null') {
      const evalPayload = await evaluateFn(cleanPayloadExpr, 'watch');
      if (evalPayload.success) {
        const obj = await variablesToJsonObject(evalPayload, expandFn, 0);
        if (detected.method === 'GET' || detected.method === 'DELETE' || detected.method === 'HEAD') {
          const appended = appendQueryParams(resolvedUrl, obj);
          resolvedUrl = appended.finalUrl;
          queryParams = appended.queryParams;
        } else {
          headers['Content-Type'] = 'application/json';
          bodyJson = typeof obj === 'string' ? obj : JSON.stringify(obj, null, 2);
        }
      } else {
        warnings.push(`Could not evaluate payload '${cleanPayloadExpr}'`);
      }
    }
  }

  // 3. Resolve AuthContext / Headers argument
  if (detected.authExpr) {
    const cleanAuthExpr = detected.authExpr.trim();
    if (cleanAuthExpr !== 'null') {
      const evalAuth = await evaluateFn(cleanAuthExpr, 'watch');
      if (evalAuth.success) {
        const authObj = await variablesToJsonObject(evalAuth, expandFn, 0);
        const extractedHeaders = extractHeadersFromAuthObject(authObj);
        Object.assign(headers, extractedHeaders);
      } else {
        warnings.push(`Could not evaluate auth/headers '${cleanAuthExpr}'`);
      }
    }
  }

  // 4. Construct clean cURL strings
  const singleParts: string[] = ['curl', '-X', detected.method, shellEscapeSingle(resolvedUrl)];
  const multiLines: string[] = [`curl -X ${detected.method} ${shellEscapeSingle(resolvedUrl)}`];

  for (const [hk, hv] of Object.entries(headers)) {
    const flag = `-H ${shellEscapeSingle(`${hk}: ${hv}`)}`;
    singleParts.push(flag);
    multiLines.push(`  ${flag}`);
  }

  if (bodyJson !== null) {
    const compactBody = (() => {
      try {
        return JSON.stringify(JSON.parse(bodyJson));
      } catch {
        return bodyJson;
      }
    })();
    singleParts.push('-d', shellEscapeSingle(compactBody));
    multiLines.push(`  -d ${shellEscapeSingle(bodyJson)}`);
  }

  return {
    curlCommand: singleParts.join(' '),
    multilineCurlCommand: multiLines.join(' \\\n'),
    method: detected.method,
    resolvedUrl,
    queryParams,
    headers,
    bodyJson,
    warnings
  };
}
