import type { ExecutionTraceStep, ReturnValueEntry, StackFrame, VariableItem } from '../types/minirider';

const EXTERNAL_FRAME_PATTERNS = [
  /^\[External Code\]/i,
  /^System\./,
  /^Microsoft\.(?!.*Controller)/,
  /^Internal\./,
  /^Interop\./,
  /^Swashbuckle\./,
  /^Newtonsoft\.Json\./,
  /^Serilog\./,
  /^AutoMapper\./,
  /^Npgsql\./,
  /^Dapper\./,
  /^MediatR\./,
  /^lambda_method/,
  /^dynamicClass/i
];

export function isExternalStackFrame(frame: Pick<StackFrame, 'name' | 'file'>): boolean {
  const fileLower = (frame.file || '').toLowerCase();
  if (
    !frame.file ||
    fileLower === 'external code' ||
    fileLower.endsWith('.dll') ||
    fileLower.includes('/.nuget/')
  ) {
    return true;
  }
  return EXTERNAL_FRAME_PATTERNS.some(rx => rx.test(frame.name || ''));
}

export function formatShortFunctionName(fullName: string): string {
  if (!fullName) return 'UnknownMethod()';
  // Handle C# async state machine MoveNext names like `MyApp.Services.GpsService.<GetTrackPointsAsync>d__4.MoveNext()`
  const asyncMatch = fullName.match(/([A-Za-z0-9_]+)\.<([A-Za-z0-9_]+)>d__\d+\.MoveNext/);
  if (asyncMatch) {
    return `${asyncMatch[1]}.${asyncMatch[2]}()`;
  }
  const parenIdx = fullName.indexOf('(');
  const head = parenIdx !== -1 ? fullName.slice(0, parenIdx) : fullName;
  const segments = head.split('.');
  const shortHead = segments.length >= 2 ? `${segments[segments.length - 2]}.${segments[segments.length - 1]}` : head;
  return parenIdx !== -1 ? `${shortHead}(...)` : shortHead;
}

export function extractFrameSummaryValues(frame: StackFrame): Array<{ name: string; value: string; type: string }> {
  const list = [...(frame.parameters || []), ...(frame.localsSnapshot || [])];
  const filtered: Array<{ name: string; value: string; type: string }> = [];
  const seen = new Set<string>();

  for (const v of list) {
    if (!v || !v.name || seen.has(v.name)) continue;
    if (v.name === 'this' || v.name.startsWith('$') || v.name.includes('CS$<>')) continue;
    seen.add(v.name);
    filtered.push({
      name: v.name,
      value: v.value,
      type: v.type
    });
    if (filtered.length >= 5) break;
  }
  return filtered;
}

export interface FlowGraphNode {
  id: string;
  orderIndex: number;
  frame: StackFrame;
  shortName: string;
  fileName: string;
  line: number;
  isCurrentBreakpoint: boolean;
  isExternal: boolean;
  valuesPreview: Array<{ name: string; value: string; type: string }>;
  returnValue?: ReturnValueEntry | StackFrame['returnValue'];
}

/**
 * Converts a DAP call stack (top = newest frame) into an ordered left-to-right / top-to-bottom
 * execution flow chain (Entry caller -> ... -> Breakpoint frame), filtering out noisy framework frames unless requested.
 */
export function buildFilteredCallFlowNodes(
  callStack: StackFrame[],
  returnValues: ReturnValueEntry[] = [],
  traceHistory: ExecutionTraceStep[] = [],
  includeExternal = false
): FlowGraphNode[] {
  if (!callStack || callStack.length === 0) return [];

  const annotated = callStack.map((frame, stackIdx) => {
    const ext = frame.isExternal !== undefined ? frame.isExternal : isExternalStackFrame(frame);
    return {
      frame,
      stackIdx,
      isExternal: ext
    };
  });

  const relevant = includeExternal
    ? annotated
    : annotated.filter((item, idx) => idx === 0 || !item.isExternal);

  // Reverse so entry point comes first (#1) and active breakpoint is last (#N)
  const chronological = [...relevant].reverse();

  return chronological.map((entry, idx) => {
    const shortName = formatShortFunctionName(entry.frame.name);
    const matchingReturn =
      entry.frame.returnValue ||
      returnValues.find(r =>
        r.functionName === entry.frame.name ||
        formatShortFunctionName(r.functionName) === shortName
      );

    // Enrich with last captured trace variables if frame localsSnapshot was empty
    const traceMatch = traceHistory.find(
      t => t.functionName === entry.frame.name || t.shortName === shortName
    );
    const hydratedFrame: StackFrame = {
      ...entry.frame,
      parameters:
        entry.frame.parameters && entry.frame.parameters.length > 0
          ? entry.frame.parameters
          : traceMatch?.parameters,
      localsSnapshot:
        entry.frame.localsSnapshot && entry.frame.localsSnapshot.length > 0
          ? entry.frame.localsSnapshot
          : traceMatch?.locals
    };

    const normFile = (entry.frame.file || '').replace(/\\/g, '/');
    const fileName = normFile.split('/').pop() || entry.frame.file || 'Unknown';

    return {
      id: `flow-${entry.frame.id}-${idx}`,
      orderIndex: idx + 1,
      frame: hydratedFrame,
      shortName,
      fileName,
      line: entry.frame.line,
      isCurrentBreakpoint: entry.stackIdx === 0,
      isExternal: entry.isExternal,
      valuesPreview: extractFrameSummaryValues(hydratedFrame),
      returnValue: matchingReturn
    };
  });
}

export function extractReturnValuesFromVariables(
  variables: VariableItem[],
  functionName: string,
  file: string,
  line: number
): ReturnValueEntry | null {
  if (!variables || variables.length === 0) return null;
  const retVar = variables.find(
    v =>
      v.name === '$ReturnValue' ||
      v.name.toLowerCase() === '$returnvalue' ||
      v.name.toLowerCase().startsWith('return value') ||
      v.scope?.toLowerCase().includes('return')
  );
  if (!retVar) return null;

  return {
    id: `ret-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    functionName: formatShortFunctionName(functionName),
    returnType: retVar.type || 'object',
    value: retVar.value,
    file,
    line,
    timestamp: new Date().toLocaleTimeString()
  };
}
