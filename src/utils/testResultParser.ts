import { TestItem } from '../types/minirider';

export interface ParsedTestOutcome {
  fullName: string;
  baseFullName: string;
  className?: string;
  namespace?: string;
  methodName: string;
  displayMethodName: string;
  projectHint?: string;
  status: 'passed' | 'failed' | 'skipped';
  durationMs?: number;
  errorMessage?: string;
  stackTrace?: string;
  skipReason?: string;
  standardOutput?: string;
  expectedValue?: string;
  actualValue?: string;
}

export interface ParsedStackFrame {
  raw: string;
  methodText: string;
  filePath?: string;
  line?: number;
  isUserCode: boolean;
}

export interface TestSummaryBreakdown {
  total: number;
  passed: number;
  failed: number;
  skipped: number;
  idle: number;
  running: number;
  durationMs: number;
  passRate: number;
}

function unescapeXml(str: string): string {
  return str
    .replace(/&#x([0-9a-fA-F]+);/g, (_, hex) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#([0-9]+);/g, (_, dec) => String.fromCodePoint(parseInt(dec, 10)))
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&');
}

function getXmlAttr(tag: string, attrName: string): string | undefined {
  const regex = new RegExp(`\\b${attrName}\\s*=\\s*(?:"([^"]*)"|'([^']*)')`, 'i');
  const match = tag.match(regex);
  if (!match) return undefined;
  return unescapeXml(match[1] ?? match[2] ?? '');
}

function parseTrxDurationMs(duration?: string): number | undefined {
  if (!duration) return undefined;
  // Format: HH:MM:SS.fffffff or MM:SS.fff
  const parts = duration.trim().split(':');
  if (parts.length !== 3) return undefined;
  const hours = parseFloat(parts[0]) || 0;
  const minutes = parseFloat(parts[1]) || 0;
  const seconds = parseFloat(parts[2]) || 0;
  const ms = (hours * 3600 + minutes * 60 + seconds) * 1000;
  if (!Number.isFinite(ms)) return undefined;
  return ms > 0 && ms < 1 ? 1 : Math.round(ms);
}

function parseConsoleDurationMs(raw?: string): number | undefined {
  if (!raw) return undefined;
  const text = raw.trim().toLowerCase();
  if (!text) return undefined;
  if (text.includes('< 1 ms') || text.includes('<1 ms')) return 1;
  const msMatch = text.match(/([\d.]+)\s*ms/);
  if (msMatch) return Math.round(parseFloat(msMatch[1]));
  const secMatch = text.match(/([\d.]+)\s*s\b/);
  if (secMatch) return Math.round(parseFloat(secMatch[1]) * 1000);
  const minMatch = text.match(/(\d+)\s*m\s*([\d.]+)?\s*s?/);
  if (minMatch) {
    return Math.round((parseInt(minMatch[1], 10) * 60 + (parseFloat(minMatch[2] || '0') || 0)) * 1000);
  }
  return undefined;
}

function stripParams(name: string): string {
  const parenIdx = name.indexOf('(');
  return parenIdx !== -1 ? name.slice(0, parenIdx).trim() : name.trim();
}

function splitNameParts(fullName: string, explicitClassName?: string): {
  namespace: string;
  className: string;
  methodName: string;
  displayMethodName: string;
  baseFullName: string;
} {
  const baseFullName = stripParams(fullName);
  const parenIdx = fullName.indexOf('(');
  const paramsSuffix = parenIdx !== -1 ? fullName.slice(parenIdx) : '';

  if (explicitClassName) {
    const cleanClassFull = stripParams(explicitClassName.split(',')[0].trim());
    const lastDot = cleanClassFull.lastIndexOf('.');
    const namespace = lastDot !== -1 ? cleanClassFull.slice(0, lastDot) : '';
    const className = lastDot !== -1 ? cleanClassFull.slice(lastDot + 1) : cleanClassFull;
    let methodPart = baseFullName;
    if (baseFullName.startsWith(`${cleanClassFull}.`)) {
      methodPart = baseFullName.slice(cleanClassFull.length + 1);
    } else if (baseFullName.includes('.')) {
      methodPart = baseFullName.slice(baseFullName.lastIndexOf('.') + 1);
    }
    return {
      namespace,
      className,
      methodName: methodPart,
      displayMethodName: `${methodPart}${paramsSuffix}`,
      baseFullName: cleanClassFull ? `${cleanClassFull}.${methodPart}` : methodPart
    };
  }

  const segments = baseFullName.split('.');
  if (segments.length >= 3) {
    const methodName = segments[segments.length - 1];
    const className = segments[segments.length - 2];
    const namespace = segments.slice(0, -2).join('.');
    return {
      namespace,
      className,
      methodName,
      displayMethodName: `${methodName}${paramsSuffix}`,
      baseFullName
    };
  }
  if (segments.length === 2) {
    return {
      namespace: '',
      className: segments[0],
      methodName: segments[1],
      displayMethodName: `${segments[1]}${paramsSuffix}`,
      baseFullName
    };
  }
  return {
    namespace: '',
    className: 'Tests',
    methodName: baseFullName,
    displayMethodName: `${baseFullName}${paramsSuffix}`,
    baseFullName
  };
}

export function extractExpectedAndActual(errorMessage?: string): {
  expectedValue?: string;
  actualValue?: string;
} {
  if (!errorMessage) return {};

  // xUnit: Expected: ...\nActual: ...
  const xunitMatch = errorMessage.match(
    /(?:^|\n)\s*Expected:\s*(.+?)\r?\n\s*Actual:\s*(.+?)(?=\r?\n\s*(?:Stack Trace:|$|\w+:)|$)/is
  );
  if (xunitMatch) {
    return {
      expectedValue: xunitMatch[1].trim(),
      actualValue: xunitMatch[2].trim()
    };
  }

  // NUnit: Expected: ...\n  But was: ...
  const nunitMatch = errorMessage.match(
    /(?:^|\n)\s*Expected:\s*(.+?)\r?\n\s*But was:\s*(.+?)(?=\r?\n|$)/is
  );
  if (nunitMatch) {
    return {
      expectedValue: nunitMatch[1].trim(),
      actualValue: nunitMatch[2].trim()
    };
  }

  // MSTest: Assert.AreEqual failed. Expected:<foo>. Actual:<bar>.
  const msTestMatch = errorMessage.match(/Expected:<([^>]*)>\.\s*Actual:<([^>]*)>/i);
  if (msTestMatch) {
    return {
      expectedValue: msTestMatch[1].trim(),
      actualValue: msTestMatch[2].trim()
    };
  }

  // FluentAssertions: Expected ... to be X, but found Y
  const fluentMatch = errorMessage.match(/Expected\s+.+?\s+to\s+(?:be|equal)\s+(.+?),?\s+but\s+found\s+(.+?)(?:\.|$)/i);
  if (fluentMatch) {
    return {
      expectedValue: fluentMatch[1].trim(),
      actualValue: fluentMatch[2].trim()
    };
  }

  return {};
}

export function parseStackTraceFrames(stackTrace?: string): ParsedStackFrame[] {
  if (!stackTrace) return [];
  const lines = stackTrace
    .split(/\r?\n/)
    .map(l => l.trim())
    .filter(Boolean);

  return lines.map(raw => {
    // Match: at Namespace.Type.Method(...) in /path/to/File.cs:line 42
    const withLocation = raw.match(/^(?:at\s+)?(.+?)\s+in\s+(.+?):line\s+(\d+)\s*$/i);
    if (withLocation) {
      const methodText = withLocation[1].trim();
      const filePath = withLocation[2].trim();
      const line = parseInt(withLocation[3], 10);
      const isFramework =
        /^(?:System\.|Microsoft\.|Xunit\.|NUnit\.|FluentAssertions\.|lambda_method)/i.test(methodText);
      return {
        raw,
        methodText,
        filePath,
        line: Number.isFinite(line) ? line : undefined,
        isUserCode: !isFramework
      };
    }

    const methodText = raw.replace(/^at\s+/i, '').trim();
    const isFramework =
      /^(?:System\.|Microsoft\.|Xunit\.|NUnit\.|FluentAssertions\.|lambda_method)/i.test(methodText);
    return {
      raw,
      methodText,
      isUserCode: !isFramework
    };
  });
}

function mapTrxOutcome(outcome?: string): 'passed' | 'failed' | 'skipped' {
  const norm = (outcome || '').toLowerCase();
  if (norm === 'passed') return 'passed';
  if (norm === 'notexecuted' || norm === 'skipped' || norm === 'inconclusive' || norm === 'pending') {
    return 'skipped';
  }
  return 'failed';
}

export function parseTrxXml(xml: string): ParsedTestOutcome[] {
  if (!xml || !xml.trim()) return [];

  const definitions = new Map<string, { className?: string; name?: string; projectHint?: string }>();
  const unitTestRegex = /<UnitTest\b([^>]*)>([\s\S]*?)<\/UnitTest>/gi;
  let defMatch: RegExpExecArray | null;
  while ((defMatch = unitTestRegex.exec(xml)) !== null) {
    const attrs = defMatch[1];
    const body = defMatch[2];
    const id = getXmlAttr(attrs, 'id');
    const name = getXmlAttr(attrs, 'name');
    const testMethodMatch = body.match(/<TestMethod\b([^>]*?)\/?\s*>/i);
    const className = testMethodMatch ? getXmlAttr(testMethodMatch[1], 'className') : undefined;
    const codeBase = testMethodMatch ? getXmlAttr(testMethodMatch[1], 'codeBase') : undefined;
    let projectHint: string | undefined;
    if (codeBase) {
      const base = codeBase.split(/[\\/]/).pop() || '';
      projectHint = base.replace(/\.dll$/i, '');
    }
    if (id) {
      definitions.set(id, { className, name, projectHint });
    }
  }

  const outcomes: ParsedTestOutcome[] = [];
  const resultRegex = /<UnitTestResult\b([^>]*?)(?:\/>|>([\s\S]*?)<\/UnitTestResult>)/gi;
  let resMatch: RegExpExecArray | null;
  while ((resMatch = resultRegex.exec(xml)) !== null) {
    const attrs = resMatch[1];
    const body = resMatch[2] || '';
    const testId = getXmlAttr(attrs, 'testId') || '';
    const testNameAttr = getXmlAttr(attrs, 'testName') || '';
    const outcomeAttr = getXmlAttr(attrs, 'outcome');
    const durationAttr = getXmlAttr(attrs, 'duration');

    const def = definitions.get(testId);
    const rawName = testNameAttr || def?.name || 'UnknownTest';
    const fullName =
      def?.className && !rawName.startsWith(stripParams(def.className.split(',')[0]) + '.')
        ? `${stripParams(def.className.split(',')[0])}.${rawName}`
        : rawName;

    const parts = splitNameParts(fullName, def?.className);
    const status = mapTrxOutcome(outcomeAttr);

    const stdOutMatch = body.match(/<StdOut>([\s\S]*?)<\/StdOut>/i);
    const stdErrMatch = body.match(/<StdErr>([\s\S]*?)<\/StdErr>/i);
    const msgMatch = body.match(/<ErrorInfo>[\s\S]*?<Message>([\s\S]*?)<\/Message>/i);
    const stackMatch = body.match(/<ErrorInfo>[\s\S]*?<StackTrace>([\s\S]*?)<\/StackTrace>/i);

    const standardOutputParts = [
      stdOutMatch ? unescapeXml(stdOutMatch[1]).trim() : '',
      stdErrMatch ? unescapeXml(stdErrMatch[1]).trim() : ''
    ].filter(Boolean);
    const standardOutput = standardOutputParts.length > 0 ? standardOutputParts.join('\n') : undefined;
    const errorMessage = msgMatch ? unescapeXml(msgMatch[1]).trim() : undefined;
    const stackTrace = stackMatch ? unescapeXml(stackMatch[1]).trim() : undefined;

    const skipReason =
      status === 'skipped'
        ? errorMessage || standardOutput || 'Marked as skipped'
        : undefined;

    const { expectedValue, actualValue } =
      status === 'failed' ? extractExpectedAndActual(errorMessage) : {};

    outcomes.push({
      fullName,
      baseFullName: parts.baseFullName,
      namespace: parts.namespace,
      className: parts.className,
      methodName: parts.methodName,
      displayMethodName: parts.displayMethodName,
      projectHint: def?.projectHint,
      status,
      durationMs: parseTrxDurationMs(durationAttr),
      errorMessage: status === 'failed' ? errorMessage : undefined,
      stackTrace: status === 'failed' ? stackTrace : undefined,
      skipReason,
      standardOutput,
      expectedValue,
      actualValue
    });
  }

  return outcomes;
}

export function parseDotnetTestStdout(output: string): ParsedTestOutcome[] {
  if (!output) return [];
  const lines = output.split(/\r?\n/);
  const outcomes: ParsedTestOutcome[] = [];

  let current: ParsedTestOutcome | null = null;
  let section: 'none' | 'error' | 'stack' | 'stdout' | 'skip' = 'none';
  let errorLines: string[] = [];
  let stackLines: string[] = [];
  let stdoutLines: string[] = [];
  let skipLines: string[] = [];

  const flushCurrent = () => {
    if (!current) return;
    const err = errorLines.join('\n').trim();
    const stk = stackLines.join('\n').trim();
    const out = stdoutLines.join('\n').trim();
    const skp = skipLines.join('\n').trim();

    if (err) current.errorMessage = err;
    if (stk) current.stackTrace = stk;
    if (out) current.standardOutput = out;
    if (current.status === 'skipped') {
      current.skipReason = skp || err || out || 'Skipped during execution';
    }
    if (current.status === 'failed' && current.errorMessage) {
      const diff = extractExpectedAndActual(current.errorMessage);
      current.expectedValue = diff.expectedValue;
      current.actualValue = diff.actualValue;
    }

    outcomes.push(current);
    current = null;
    section = 'none';
    errorLines = [];
    stackLines = [];
    stdoutLines = [];
    skipLines = [];
  };

  for (const rawLine of lines) {
    // Summary boundary lines stop active test detail capture
    if (/^\s*(?:Passed!|Failed!|Total tests:|Test Run (?:Successful|Failed|Aborted))/i.test(rawLine)) {
      flushCurrent();
      continue;
    }

    const headerMatch = rawLine.match(
      /^\s*(Passed|Failed|Skipped)\s+(.+?)(?:\s+\[([^\]]+)\])?\s*$/
    );
    if (headerMatch) {
      const statusRaw = headerMatch[1].toLowerCase();
      const rawName = headerMatch[2].trim();
      // Ignore build lines accidentally matching something else without dots/identifiers
      if (rawName && !rawName.startsWith('-')) {
        flushCurrent();
        const status: 'passed' | 'failed' | 'skipped' =
          statusRaw === 'passed' ? 'passed' : statusRaw === 'failed' ? 'failed' : 'skipped';
        const parts = splitNameParts(rawName);
        current = {
          fullName: rawName,
          baseFullName: parts.baseFullName,
          namespace: parts.namespace,
          className: parts.className,
          methodName: parts.methodName,
          displayMethodName: parts.displayMethodName,
          status,
          durationMs: parseConsoleDurationMs(headerMatch[3])
        };
        if (status === 'skipped') {
          section = 'skip';
        }
        continue;
      }
    }

    if (!current) continue;

    const trimmed = rawLine.trim();
    if (/^Error Message:\s*$/i.test(trimmed)) {
      section = 'error';
      continue;
    }
    if (/^Stack Trace:\s*$/i.test(trimmed)) {
      section = 'stack';
      continue;
    }
    if (/^Standard Output Messages:\s*$/i.test(trimmed)) {
      section = 'stdout';
      continue;
    }
    if (/^Reason:\s*/i.test(trimmed)) {
      section = 'skip';
      const inlineReason = trimmed.replace(/^Reason:\s*/i, '').trim();
      if (inlineReason) skipLines.push(inlineReason);
      continue;
    }

    if (section === 'error') {
      errorLines.push(rawLine.replace(/^\s{2,4}/, ''));
    } else if (section === 'stack') {
      stackLines.push(rawLine.replace(/^\s{2,4}/, ''));
    } else if (section === 'stdout') {
      stdoutLines.push(rawLine.replace(/^\s{2,4}/, ''));
    } else if (section === 'skip' && trimmed) {
      skipLines.push(trimmed);
    }
  }

  flushCurrent();
  return outcomes;
}

export function parseCombinedDotnetTestResults(
  trxContents: Array<{ fileName: string; xml: string }> | undefined,
  stdout: string,
  stderr: string
): ParsedTestOutcome[] {
  const trxOutcomes: ParsedTestOutcome[] = [];
  if (Array.isArray(trxContents)) {
    for (const trx of trxContents) {
      trxOutcomes.push(...parseTrxXml(trx.xml));
    }
  }

  const consoleOutcomes = parseDotnetTestStdout(`${stdout}\n${stderr}`);

  if (trxOutcomes.length === 0) {
    return consoleOutcomes;
  }

  // Enrich TRX results with any missing console details
  const consoleByName = new Map<string, ParsedTestOutcome>();
  for (const co of consoleOutcomes) {
    consoleByName.set(co.fullName.toLowerCase(), co);
  }

  return trxOutcomes.map(to => {
    const match = consoleByName.get(to.fullName.toLowerCase());
    if (!match) return to;
    return {
      ...to,
      durationMs: to.durationMs ?? match.durationMs,
      errorMessage: to.errorMessage || match.errorMessage,
      stackTrace: to.stackTrace || match.stackTrace,
      skipReason: to.skipReason || match.skipReason,
      standardOutput: to.standardOutput || match.standardOutput,
      expectedValue: to.expectedValue || match.expectedValue,
      actualValue: to.actualValue || match.actualValue
    };
  });
}

function outcomeMatchesTest(outcome: ParsedTestOutcome, test: TestItem): boolean {
  const oFull = outcome.fullName.toLowerCase();
  const oBase = outcome.baseFullName.toLowerCase();
  const tFull = test.fullName.toLowerCase();
  const tBase = stripParams(test.fullName).toLowerCase();

  if (oFull === tFull) return true;

  // If the existing test row is already a specific parameterized case (e.g. Theory row),
  // do not match other parameter variants against it.
  if (tFull.includes('(') && oFull.includes('(')) {
    return false;
  }

  if (oBase === tBase) return true;

  const classMethod = `${test.className}.${stripParams(test.methodName)}`.toLowerCase();
  const oClassMethod = `${outcome.className || ''}.${outcome.methodName}`.toLowerCase();
  if (classMethod === oClassMethod) {
    if (!outcome.projectHint || !test.projectName) return true;
    return outcome.projectHint.toLowerCase() === test.projectName.toLowerCase();
  }

  return false;
}

export function mergeTestResults(
  existingTests: TestItem[],
  outcomes: ParsedTestOutcome[],
  options: {
    targetedTestIds?: Set<string>;
    runSucceeded: boolean;
    fallbackErrorOutput?: string;
    timestamp?: string;
  }
): TestItem[] {
  const now = options.timestamp || new Date().toISOString();
  const matchedOutcomeIndices = new Set<number>();
  const nextTests: TestItem[] = [];

  for (const test of existingTests) {
    const isTargeted = !options.targetedTestIds || options.targetedTestIds.has(test.id);
    if (!isTargeted) {
      nextTests.push(test);
      continue;
    }

    const matchingOutcomes: Array<{ outcome: ParsedTestOutcome; idx: number }> = [];
    outcomes.forEach((outcome, idx) => {
      if (outcomeMatchesTest(outcome, test)) {
        matchingOutcomes.push({ outcome, idx });
        matchedOutcomeIndices.add(idx);
      }
    });

    if (matchingOutcomes.length === 0) {
      // No explicit test outcome parsed (e.g. build error or filter excluded it)
      if (!options.runSucceeded && options.fallbackErrorOutput?.trim()) {
        nextTests.push({
          ...test,
          status: 'failed',
          errorMessage: options.fallbackErrorOutput.trim().slice(0, 4000),
          lastRunAt: now
        });
      } else {
        nextTests.push({
          ...test,
          status: test.status === 'running' ? 'idle' : test.status
        });
      }
      continue;
    }

    // If a static [Theory] method produced multiple parameterized outcomes, expand each case
    // unless test.methodName already has explicit parameters
    const hasParameterizedCases =
      matchingOutcomes.length > 1 ||
      (!test.methodName.includes('(') && matchingOutcomes[0].outcome.displayMethodName.includes('('));

    if (hasParameterizedCases) {
      for (const { outcome } of matchingOutcomes) {
        nextTests.push({
          ...test,
          id: `${test.id}::${outcome.displayMethodName}`,
          methodName: outcome.displayMethodName,
          fullName: outcome.fullName,
          status: outcome.status,
          durationMs: outcome.durationMs,
          errorMessage: outcome.errorMessage,
          stackTrace: outcome.stackTrace,
          skipReason: outcome.skipReason ?? (outcome.status === 'skipped' ? test.skipReason : undefined),
          standardOutput: outcome.standardOutput,
          expectedValue: outcome.expectedValue,
          actualValue: outcome.actualValue,
          lastRunAt: now
        });
      }
    } else {
      const { outcome } = matchingOutcomes[0];
      nextTests.push({
        ...test,
        status: outcome.status,
        durationMs: outcome.durationMs,
        errorMessage: outcome.errorMessage,
        stackTrace: outcome.stackTrace,
        skipReason: outcome.skipReason ?? (outcome.status === 'skipped' ? test.skipReason : undefined),
        standardOutput: outcome.standardOutput,
        expectedValue: outcome.expectedValue,
        actualValue: outcome.actualValue,
        lastRunAt: now
      });
    }
  }

  // Append any dynamically discovered tests reported by dotnet test that weren't statically indexed
  // (avoid duplicating expanded theory rows if existingTests already held them from a previous run)
  const existingKeys = new Set(nextTests.map(t => `${t.projectName}::${t.fullName}`.toLowerCase()));
  outcomes.forEach((outcome, idx) => {
    if (matchedOutcomeIndices.has(idx)) return;
    const projectName = outcome.projectHint || existingTests[0]?.projectName || 'Tests';
    const key = `${projectName}::${outcome.fullName}`.toLowerCase();
    if (existingKeys.has(key)) return;
    existingKeys.add(key);

    nextTests.push({
      id: `test-dyn-${projectName}-${outcome.fullName}`,
      projectName,
      namespace: outcome.namespace || '',
      className: outcome.className || 'Tests',
      methodName: outcome.displayMethodName,
      fullName: outcome.fullName,
      status: outcome.status,
      durationMs: outcome.durationMs,
      errorMessage: outcome.errorMessage,
      stackTrace: outcome.stackTrace,
      skipReason: outcome.skipReason,
      standardOutput: outcome.standardOutput,
      expectedValue: outcome.expectedValue,
      actualValue: outcome.actualValue,
      lastRunAt: now
    });
  });

  return nextTests;
}

export function summarizeTests(items: TestItem[]): TestSummaryBreakdown {
  const total = items.length;
  let passed = 0;
  let failed = 0;
  let skipped = 0;
  let idle = 0;
  let running = 0;
  let durationMs = 0;

  for (const t of items) {
    if (t.status === 'passed') passed++;
    else if (t.status === 'failed') failed++;
    else if (t.status === 'skipped') skipped++;
    else if (t.status === 'running') running++;
    else idle++;
    durationMs += t.durationMs || 0;
  }

  const executed = passed + failed;
  const passRate = executed > 0 ? Math.round((passed / executed) * 1000) / 10 : total > 0 && passed === total ? 100 : 0;

  return { total, passed, failed, skipped, idle, running, durationMs, passRate };
}

export function buildTestSummaryReport(
  tests: TestItem[],
  solutionName: string,
  format: 'markdown' | 'text' = 'markdown'
): string {
  const summary = summarizeTests(tests);
  const generatedAt = new Date().toLocaleString();
  const failedTests = tests.filter(t => t.status === 'failed');
  const skippedTests = tests.filter(t => t.status === 'skipped');

  // Group breakdown by project -> class
  const byProject = new Map<string, Map<string, TestItem[]>>();
  for (const t of tests) {
    if (!byProject.has(t.projectName)) byProject.set(t.projectName, new Map());
    const classMap = byProject.get(t.projectName)!;
    if (!classMap.has(t.className)) classMap.set(t.className, []);
    classMap.get(t.className)!.push(t);
  }

  if (format === 'text') {
    const lines: string[] = [
      `TEST EXECUTION REPORT — ${solutionName}`,
      `Generated: ${generatedAt}`,
      `========================================================================`,
      `Summary: Total=${summary.total} | Passed=${summary.passed} | Failed=${summary.failed} | Skipped=${summary.skipped} | Not Run=${summary.idle} | Pass Rate=${summary.passRate}% | Duration=${summary.durationMs}ms`,
      ``
    ];

    lines.push('SUITE BREAKDOWN BY PROJECT & CLASS:');
    for (const [proj, classMap] of byProject.entries()) {
      const projTests = Array.from(classMap.values()).flat();
      const ps = summarizeTests(projTests);
      lines.push(`  [Project] ${proj} (${ps.passed} passed, ${ps.failed} failed, ${ps.skipped} skipped, ${ps.durationMs}ms)`);
      for (const [cls, clsTests] of classMap.entries()) {
        const cs = summarizeTests(clsTests);
        const tag = cs.failed > 0 ? 'FAIL' : cs.skipped > 0 ? 'WARN' : cs.passed === cs.total ? 'PASS' : 'IDLE';
        lines.push(`    [${tag}] ${cls}: ${cs.passed} passed, ${cs.failed} failed, ${cs.skipped} skipped (${cs.durationMs}ms)`);
      }
    }

    if (failedTests.length > 0) {
      lines.push('', `FAILED TESTS (${failedTests.length}):`, `------------------------------------------------------------------------`);
      failedTests.forEach((t, idx) => {
        lines.push(`${idx + 1}. ${t.fullName} (${t.projectName}, ${t.durationMs ?? 0}ms)`);
        if (t.filePath) lines.push(`   Location: ${t.filePath}${t.line ? `:${t.line}` : ''}`);
        if (t.expectedValue !== undefined || t.actualValue !== undefined) {
          lines.push(`   Expected: ${t.expectedValue ?? '(n/a)'}`);
          lines.push(`   Actual:   ${t.actualValue ?? '(n/a)'}`);
        }
        if (t.errorMessage) lines.push(`   Error:\n     ${t.errorMessage.replace(/\n/g, '\n     ')}`);
        if (t.stackTrace) lines.push(`   Stack Trace:\n     ${t.stackTrace.replace(/\n/g, '\n     ')}`);
        lines.push('');
      });
    }

    if (skippedTests.length > 0) {
      lines.push(`SKIPPED TESTS (${skippedTests.length}):`, `------------------------------------------------------------------------`);
      skippedTests.forEach((t, idx) => {
        lines.push(`${idx + 1}. ${t.fullName} — Reason: ${t.skipReason || 'No reason provided'}`);
      });
    }

    return lines.join('\n');
  }

  // Markdown format
  const md: string[] = [
    `# Test Execution Report — ${solutionName}`,
    `_Generated: ${generatedAt}_`,
    ``,
    `## Overall Summary`,
    `| Total | Passed | Failed | Skipped | Not Run | Pass Rate | Duration |`,
    `| ---: | ---: | ---: | ---: | ---: | ---: | ---: |`,
    `| ${summary.total} | ${summary.passed} | ${summary.failed} | ${summary.skipped} | ${summary.idle} | ${summary.passRate}% | ${summary.durationMs} ms |`,
    ``,
    `## Breakdown by Project & Class`,
    `| Project / Test Class | Status | Passed | Failed | Skipped | Duration |`,
    `| :--- | :--- | ---: | ---: | ---: | ---: |`
  ];

  for (const [proj, classMap] of byProject.entries()) {
    const projTests = Array.from(classMap.values()).flat();
    const ps = summarizeTests(projTests);
    const pBadge = ps.failed > 0 ? 'FAILED' : ps.skipped > 0 ? 'SKIPPED' : ps.passed === ps.total ? 'PASSED' : 'IDLE';
    md.push(`| **${proj}** | **${pBadge}** | ${ps.passed} | ${ps.failed} | ${ps.skipped} | ${ps.durationMs} ms |`);
    for (const [cls, clsTests] of classMap.entries()) {
      const cs = summarizeTests(clsTests);
      const cBadge = cs.failed > 0 ? 'FAILED' : cs.skipped > 0 ? 'SKIPPED' : cs.passed === cs.total ? 'PASSED' : 'IDLE';
      md.push(`| &nbsp;&nbsp;↳ \`${cls}\` | ${cBadge} | ${cs.passed} | ${cs.failed} | ${cs.skipped} | ${cs.durationMs} ms |`);
    }
  }

  if (failedTests.length > 0) {
    md.push('', `## Failed Tests (${failedTests.length})`);
    failedTests.forEach((t, idx) => {
      md.push(`### ${idx + 1}. \`${t.className}.${t.methodName}\``);
      md.push(`- **Project:** ${t.projectName}`);
      md.push(`- **Full Name:** \`${t.fullName}\``);
      if (t.filePath) {
        md.push(`- **Source:** \`${t.filePath}${t.line ? `:${t.line}` : ''}\``);
      }
      if (t.durationMs !== undefined) {
        md.push(`- **Duration:** ${t.durationMs} ms`);
      }
      if (t.expectedValue !== undefined || t.actualValue !== undefined) {
        md.push(`- **Expected:** \`${t.expectedValue ?? ''}\``);
        md.push(`- **Actual:** \`${t.actualValue ?? ''}\``);
      }
      if (t.errorMessage) {
        md.push(`**Error Message:**`);
        md.push('```text');
        md.push(t.errorMessage);
        md.push('```');
      }
      if (t.stackTrace) {
        md.push(`**Stack Trace:**`);
        md.push('```text');
        md.push(t.stackTrace);
        md.push('```');
      }
      if (t.standardOutput) {
        md.push(`**Standard Output:**`);
        md.push('```text');
        md.push(t.standardOutput);
        md.push('```');
      }
    });
  }

  if (skippedTests.length > 0) {
    md.push('', `## Skipped Tests (${skippedTests.length})`);
    skippedTests.forEach((t, idx) => {
      md.push(`${idx + 1}. \`${t.fullName}\` — **Reason:** ${t.skipReason || 'No reason provided'}`);
    });
  }

  return md.join('\n');
}
