import React, { useEffect, useMemo, useState } from 'react';
import {
  Play,
  Bug,
  RotateCw,
  CheckCircle2,
  XCircle,
  SkipForward,
  Circle,
  ChevronRight,
  ChevronDown,
  ChevronUp,
  Search,
  FlaskConical,
  FolderGit2,
  FileText,
  Copy,
  Check,
  Download,
  X,
  ExternalLink,
  AlertTriangle,
  ChevronsDownUp,
  ChevronsUpDown
} from 'lucide-react';
import { TestItem } from '../types/minirider';
import {
  buildTestSummaryReport,
  extractExpectedAndActual,
  parseStackTraceFrames,
  summarizeTests
} from '../utils/testResultParser';

export type TestStatusFilter = 'all' | 'failed' | 'skipped' | 'passed' | 'idle';

interface TestExplorerProps {
  tests: TestItem[];
  solutionName?: string;
  onRunAllTests: () => void;
  onRunFailedTests?: () => void;
  onRunTestGroup?: (scope: { projectName: string; className?: string; namespace?: string }) => void;
  onRunTest: (test: TestItem) => void;
  onDebugTest: (test: TestItem) => void;
  isRunningTests: boolean;
  onNavigateToTest: (test: TestItem) => void;
  onNavigateToLocation?: (filePath: string, line: number) => void;
}

interface ClassGroup {
  className: string;
  namespace: string;
  tests: TestItem[];
}

interface ProjectGroup {
  projectName: string;
  tests: TestItem[];
  classes: ClassGroup[];
}

export const TestExplorer: React.FC<TestExplorerProps> = ({
  tests,
  solutionName = 'Solution',
  onRunAllTests,
  onRunFailedTests,
  onRunTestGroup,
  onRunTest,
  onDebugTest,
  isRunningTests,
  onNavigateToTest,
  onNavigateToLocation
}) => {
  const [searchFilter, setSearchFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState<TestStatusFilter>('all');
  const [selectedTestId, setSelectedTestId] = useState<string | null>(tests[0]?.id || null);
  const [expandedProjects, setExpandedProjects] = useState<Record<string, boolean>>({});
  const [expandedClasses, setExpandedClasses] = useState<Record<string, boolean>>({});
  const [isInspectorExpanded, setIsInspectorExpanded] = useState<boolean>(false);
  const [isReportModalOpen, setIsReportModalOpen] = useState<boolean>(false);
  const [reportFormat, setReportFormat] = useState<'markdown' | 'text'>('markdown');
  const [copiedKey, setCopiedKey] = useState<string | null>(null);

  const overall = useMemo(() => summarizeTests(tests), [tests]);

  // Keep selectedTestId valid as tests reload or expand dynamically
  useEffect(() => {
    if (tests.length === 0) {
      setSelectedTestId(null);
      return;
    }
    if (!selectedTestId || !tests.some(t => t.id === selectedTestId)) {
      const firstFailed = tests.find(t => t.status === 'failed');
      setSelectedTestId((firstFailed || tests[0]).id);
    }
  }, [tests, selectedTestId]);

  // Auto-expand projects and classes with issues when new test data arrives
  useEffect(() => {
    const nextProj: Record<string, boolean> = {};
    const nextCls: Record<string, boolean> = {};
    const hasAnyFailureOrSkip = tests.some(t => t.status === 'failed' || t.status === 'skipped');

    for (const t of tests) {
      const classKey = `${t.projectName}::${t.className}`;
      if (!(t.projectName in expandedProjects)) {
        nextProj[t.projectName] = true;
      }
      if (!(classKey in expandedClasses)) {
        nextCls[classKey] = !hasAnyFailureOrSkip || t.status === 'failed' || t.status === 'skipped';
      } else if (t.status === 'failed') {
        nextCls[classKey] = true;
        nextProj[t.projectName] = true;
      }
    }

    if (Object.keys(nextProj).length > 0) {
      setExpandedProjects(prev => ({ ...prev, ...nextProj }));
    }
    if (Object.keys(nextCls).length > 0) {
      setExpandedClasses(prev => ({ ...prev, ...nextCls }));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tests]);

  const filteredTests = useMemo(() => {
    const q = searchFilter.trim().toLowerCase();
    return tests.filter(t => {
      if (statusFilter !== 'all' && t.status !== statusFilter) return false;
      if (!q) return true;
      return (
        t.fullName.toLowerCase().includes(q) ||
        t.methodName.toLowerCase().includes(q) ||
        t.className.toLowerCase().includes(q) ||
        t.projectName.toLowerCase().includes(q) ||
        (t.errorMessage || '').toLowerCase().includes(q) ||
        (t.skipReason || '').toLowerCase().includes(q)
      );
    });
  }, [tests, statusFilter, searchFilter]);

  // Group into Project -> Class -> Tests
  const projectGroups: ProjectGroup[] = useMemo(() => {
    const projMap = new Map<string, Map<string, ClassGroup>>();

    for (const t of filteredTests) {
      if (!projMap.has(t.projectName)) {
        projMap.set(t.projectName, new Map());
      }
      const clsMap = projMap.get(t.projectName)!;
      if (!clsMap.has(t.className)) {
        clsMap.set(t.className, {
          className: t.className,
          namespace: t.namespace,
          tests: []
        });
      }
      clsMap.get(t.className)!.tests.push(t);
    }

    return Array.from(projMap.entries()).map(([projectName, clsMap]) => {
      const classes = Array.from(clsMap.values());
      return {
        projectName,
        tests: classes.flatMap(c => c.tests),
        classes
      };
    });
  }, [filteredTests]);

  // Full unfiltered parent breakdowns so parent badges reflect ALL tests in that parent even when searching/filtering,
  // or when filtering by status we still show what happened inside that parent cleanly.
  const fullParentStats = useMemo(() => {
    const byProject = new Map<string, ReturnType<typeof summarizeTests>>();
    const byClass = new Map<string, ReturnType<typeof summarizeTests>>();
    const projBuckets = new Map<string, TestItem[]>();
    const clsBuckets = new Map<string, TestItem[]>();

    for (const t of tests) {
      if (!projBuckets.has(t.projectName)) projBuckets.set(t.projectName, []);
      projBuckets.get(t.projectName)!.push(t);

      const ck = `${t.projectName}::${t.className}`;
      if (!clsBuckets.has(ck)) clsBuckets.set(ck, []);
      clsBuckets.get(ck)!.push(t);
    }

    for (const [k, items] of projBuckets.entries()) byProject.set(k, summarizeTests(items));
    for (const [k, items] of clsBuckets.entries()) byClass.set(k, summarizeTests(items));
    return { byProject, byClass };
  }, [tests]);

  const selectedTest = tests.find(t => t.id === selectedTestId) || null;
  const parsedExpectedActual = useMemo(() => {
    if (!selectedTest) return {};
    if (selectedTest.expectedValue !== undefined || selectedTest.actualValue !== undefined) {
      return {
        expectedValue: selectedTest.expectedValue,
        actualValue: selectedTest.actualValue
      };
    }
    return extractExpectedAndActual(selectedTest.errorMessage);
  }, [selectedTest]);

  const parsedStackFrames = useMemo(
    () => parseStackTraceFrames(selectedTest?.stackTrace),
    [selectedTest?.stackTrace]
  );

  const reportContent = useMemo(
    () => buildTestSummaryReport(tests, solutionName, reportFormat),
    [tests, solutionName, reportFormat]
  );

  const handleCopy = async (key: string, text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedKey(key);
      setTimeout(() => setCopiedKey(prev => (prev === key ? null : prev)), 1800);
    } catch {
      // Clipboard API unavailable
    }
  };

  const handleDownloadReport = () => {
    const ext = reportFormat === 'markdown' ? 'md' : 'txt';
    const mime = reportFormat === 'markdown' ? 'text/markdown;charset=utf-8' : 'text/plain;charset=utf-8';
    const blob = new Blob([reportContent], { type: mime });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${solutionName.replace(/\.slnx?$/i, '')}-test-report.${ext}`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const expandAll = () => {
    const p: Record<string, boolean> = {};
    const c: Record<string, boolean> = {};
    for (const t of tests) {
      p[t.projectName] = true;
      c[`${t.projectName}::${t.className}`] = true;
    }
    setExpandedProjects(p);
    setExpandedClasses(c);
  };

  const collapseAll = () => {
    const p: Record<string, boolean> = {};
    const c: Record<string, boolean> = {};
    for (const t of tests) {
      p[t.projectName] = false;
      c[`${t.projectName}::${t.className}`] = false;
    }
    setExpandedProjects(p);
    setExpandedClasses(c);
  };

  const expandIssuesOnly = () => {
    const p: Record<string, boolean> = {};
    const c: Record<string, boolean> = {};
    for (const t of tests) {
      const hasIssue = t.status === 'failed' || t.status === 'skipped';
      if (hasIssue) {
        p[t.projectName] = true;
        c[`${t.projectName}::${t.className}`] = true;
      } else {
        if (!(t.projectName in p)) p[t.projectName] = false;
        const ck = `${t.projectName}::${t.className}`;
        if (!(ck in c)) c[ck] = false;
      }
    }
    setExpandedProjects(p);
    setExpandedClasses(c);
  };

  const renderRolledUpIcon = (stats: ReturnType<typeof summarizeTests>) => {
    if (stats.running > 0) {
      return <RotateCw className="w-3.5 h-3.5 text-blue-400 animate-spin shrink-0" />;
    }
    if (stats.failed > 0) {
      return <XCircle className="w-3.5 h-3.5 text-red-400 shrink-0" />;
    }
    if (stats.skipped > 0 && stats.passed === 0) {
      return <SkipForward className="w-3.5 h-3.5 text-amber-400 shrink-0" />;
    }
    if (stats.skipped > 0) {
      return <AlertTriangle className="w-3.5 h-3.5 text-amber-400 shrink-0" />;
    }
    if (stats.passed > 0 && stats.idle === 0) {
      return <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400 shrink-0" />;
    }
    if (stats.passed > 0) {
      return <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400/70 shrink-0" />;
    }
    return <Circle className="w-3.5 h-3.5 text-gray-500 shrink-0" />;
  };

  const renderParentBadges = (stats: ReturnType<typeof summarizeTests>) => (
    <div className="flex items-center space-x-1 shrink-0 text-[10px] font-medium">
      {stats.failed > 0 && (
        <span className="px-1.5 py-0.5 rounded bg-red-500/20 text-red-300 border border-red-500/30">
          {stats.failed}F
        </span>
      )}
      {stats.skipped > 0 && (
        <span className="px-1.5 py-0.5 rounded bg-amber-500/20 text-amber-300 border border-amber-500/30">
          {stats.skipped}S
        </span>
      )}
      {stats.passed > 0 && (
        <span className="px-1.5 py-0.5 rounded bg-emerald-500/15 text-emerald-300 border border-emerald-500/25">
          {stats.passed}P
        </span>
      )}
      {stats.idle > 0 && stats.failed === 0 && stats.skipped === 0 && stats.passed === 0 && (
        <span className="px-1.5 py-0.5 rounded bg-[#2b2d30] text-gray-400">
          {stats.idle}
        </span>
      )}
    </div>
  );

  const renderTestStatusIcon = (status: TestItem['status']) => {
    switch (status) {
      case 'passed':
        return <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400 shrink-0" />;
      case 'failed':
        return <XCircle className="w-3.5 h-3.5 text-red-400 shrink-0" />;
      case 'skipped':
        return <SkipForward className="w-3.5 h-3.5 text-amber-400 shrink-0" />;
      case 'running':
        return <RotateCw className="w-3.5 h-3.5 text-blue-400 animate-spin shrink-0" />;
      default:
        return <Circle className="w-3.5 h-3.5 text-gray-500 shrink-0" />;
    }
  };

  const passedPct = overall.total > 0 ? (overall.passed / overall.total) * 100 : 0;
  const skippedPct = overall.total > 0 ? (overall.skipped / overall.total) * 100 : 0;
  const failedPct = overall.total > 0 ? (overall.failed / overall.total) * 100 : 0;

  return (
    <div className="flex flex-col h-full bg-[#1e1f22] text-[#bcbec4] text-xs select-none overflow-hidden">
      {/* Primary Action Toolbar */}
      <div className="bg-[#26282b] border-b border-[#1e1f22] px-2.5 py-2 space-y-2 shrink-0">
        <div className="flex items-center justify-between gap-1.5 flex-wrap">
          <div className="flex items-center gap-1.5">
            <button
              onClick={onRunAllTests}
              disabled={isRunningTests || tests.length === 0}
              className={`flex items-center space-x-1 px-2 py-1 rounded text-white font-medium transition text-[11px] ${
                isRunningTests
                  ? 'bg-blue-600/50 cursor-wait'
                  : 'bg-blue-600 hover:bg-blue-500 shadow-sm disabled:opacity-40'
              }`}
              title="Run All Tests in Solution (dotnet test)"
            >
              <Play className={`w-3 h-3 fill-current ${isRunningTests ? 'animate-pulse' : ''}`} />
              <span>Run All</span>
            </button>

            {overall.failed > 0 && onRunFailedTests && (
              <button
                onClick={onRunFailedTests}
                disabled={isRunningTests}
                className="flex items-center space-x-1 px-2 py-1 rounded bg-red-600/90 hover:bg-red-500 text-white font-medium transition text-[11px] shadow-sm disabled:opacity-40"
                title="Re-run only failed tests"
              >
                <RotateCw className={`w-3 h-3 ${isRunningTests ? 'animate-spin' : ''}`} />
                <span>Run Failed ({overall.failed})</span>
              </button>
            )}
          </div>

          <button
            onClick={() => setIsReportModalOpen(true)}
            disabled={tests.length === 0}
            className="flex items-center space-x-1 px-2 py-1 rounded bg-[#2f3237] hover:bg-[#393c42] text-slate-200 border border-[#3e4147] font-medium transition text-[11px] disabled:opacity-40"
            title="Open Full Test Execution Report"
          >
            <FileText className="w-3 h-3 text-blue-400" />
            <span>Report</span>
          </button>
        </div>

        {/* Summary Metrics & Segmented Bar */}
        <div className="space-y-1">
          <div className="flex items-center justify-between text-[11px]">
            <div className="flex items-center space-x-2 font-medium">
              <span className="text-emerald-400">{overall.passed} passed</span>
              <span className={overall.failed > 0 ? 'text-red-400 font-semibold' : 'text-gray-500'}>
                {overall.failed} failed
              </span>
              <span className={overall.skipped > 0 ? 'text-amber-400 font-semibold' : 'text-gray-500'}>
                {overall.skipped} skipped
              </span>
            </div>
            <span className="text-[10px] text-gray-400 font-mono">
              {overall.durationMs}ms
            </span>
          </div>

          <div className="h-1.5 w-full bg-[#18191c] rounded-full overflow-hidden flex">
            {passedPct > 0 && (
              <div style={{ width: `${passedPct}%` }} className="bg-emerald-500 transition-all duration-300" />
            )}
            {skippedPct > 0 && (
              <div style={{ width: `${skippedPct}%` }} className="bg-amber-400 transition-all duration-300" />
            )}
            {failedPct > 0 && (
              <div style={{ width: `${failedPct}%` }} className="bg-red-500 transition-all duration-300" />
            )}
          </div>
        </div>
      </div>

      {/* Status Filter Strip + Search + Tree Controls */}
      <div className="p-2 border-b border-[#2b2d30] bg-[#212327] space-y-2 shrink-0">
        {/* Status Filters */}
        <div className="flex items-center gap-1 flex-wrap">
          <button
            onClick={() => setStatusFilter('all')}
            className={`px-2 py-0.5 rounded text-[10px] font-medium border transition ${
              statusFilter === 'all'
                ? 'bg-blue-600/25 text-blue-300 border-blue-500/50'
                : 'bg-[#1a1b1e] text-gray-400 border-[#2f3237] hover:text-gray-200'
            }`}
          >
            All ({overall.total})
          </button>

          <button
            onClick={() => setStatusFilter(statusFilter === 'failed' ? 'all' : 'failed')}
            className={`px-2 py-0.5 rounded text-[10px] font-medium border transition flex items-center space-x-1 ${
              statusFilter === 'failed'
                ? 'bg-red-500/25 text-red-200 border-red-500/60'
                : overall.failed > 0
                  ? 'bg-red-500/10 text-red-300 border-red-500/30 hover:bg-red-500/20'
                  : 'bg-[#1a1b1e] text-gray-500 border-[#2f3237] hover:text-gray-300'
            }`}
          >
            <XCircle className="w-2.5 h-2.5" />
            <span>Failed ({overall.failed})</span>
          </button>

          <button
            onClick={() => setStatusFilter(statusFilter === 'skipped' ? 'all' : 'skipped')}
            className={`px-2 py-0.5 rounded text-[10px] font-medium border transition flex items-center space-x-1 ${
              statusFilter === 'skipped'
                ? 'bg-amber-500/25 text-amber-200 border-amber-500/60'
                : overall.skipped > 0
                  ? 'bg-amber-500/10 text-amber-300 border-amber-500/30 hover:bg-amber-500/20'
                  : 'bg-[#1a1b1e] text-gray-500 border-[#2f3237] hover:text-gray-300'
            }`}
          >
            <SkipForward className="w-2.5 h-2.5" />
            <span>Skipped ({overall.skipped})</span>
          </button>

          <button
            onClick={() => setStatusFilter(statusFilter === 'passed' ? 'all' : 'passed')}
            className={`px-2 py-0.5 rounded text-[10px] font-medium border transition flex items-center space-x-1 ${
              statusFilter === 'passed'
                ? 'bg-emerald-500/25 text-emerald-200 border-emerald-500/60'
                : 'bg-[#1a1b1e] text-gray-400 border-[#2f3237] hover:text-emerald-300'
            }`}
          >
            <CheckCircle2 className="w-2.5 h-2.5" />
            <span>Passed ({overall.passed})</span>
          </button>

          {overall.idle > 0 && (
            <button
              onClick={() => setStatusFilter(statusFilter === 'idle' ? 'all' : 'idle')}
              className={`px-2 py-0.5 rounded text-[10px] font-medium border transition ${
                statusFilter === 'idle'
                  ? 'bg-slate-600/30 text-slate-200 border-slate-400/50'
                  : 'bg-[#1a1b1e] text-gray-400 border-[#2f3237] hover:text-gray-200'
              }`}
            >
              Not Run ({overall.idle})
            </button>
          )}
        </div>

        {/* Search + Expand/Collapse Actions */}
        <div className="flex items-center gap-1.5">
          <div className="relative flex-1">
            <Search className="w-3.5 h-3.5 absolute left-2 top-1.5 text-gray-400" />
            <input
              type="text"
              placeholder="Search tests, classes, errors..."
              value={searchFilter}
              onChange={e => setSearchFilter(e.target.value)}
              className="w-full bg-[#1e1f22] text-white border border-[#393b40] rounded pl-7 pr-6 py-1 text-[11px] focus:outline-none focus:border-blue-500"
            />
            {searchFilter && (
              <button
                onClick={() => setSearchFilter('')}
                className="absolute right-1.5 top-1.5 text-gray-400 hover:text-white"
                title="Clear search"
              >
                <X className="w-3 h-3" />
              </button>
            )}
          </div>

          {(overall.failed > 0 || overall.skipped > 0) && (
            <button
              onClick={expandIssuesOnly}
              className="p-1.5 rounded bg-[#1a1b1e] border border-[#393b40] text-amber-300 hover:bg-[#2b2d30]"
              title="Expand only projects & classes with failed or skipped tests"
            >
              <AlertTriangle className="w-3 h-3" />
            </button>
          )}
          <button
            onClick={expandAll}
            className="p-1.5 rounded bg-[#1a1b1e] border border-[#393b40] text-gray-400 hover:text-white hover:bg-[#2b2d30]"
            title="Expand All"
          >
            <ChevronsUpDown className="w-3 h-3" />
          </button>
          <button
            onClick={collapseAll}
            className="p-1.5 rounded bg-[#1a1b1e] border border-[#393b40] text-gray-400 hover:text-white hover:bg-[#2b2d30]"
            title="Collapse All"
          >
            <ChevronsDownUp className="w-3 h-3" />
          </button>
        </div>
      </div>

      {/* Main Hierarchical Tree (Top) */}
      {!isInspectorExpanded && (
        <div className="flex-1 overflow-y-auto p-1.5 space-y-1 min-h-[140px]">
          {tests.length === 0 ? (
            <div className="p-4 text-center text-gray-500 space-y-1">
              <FlaskConical className="w-6 h-6 mx-auto text-gray-600" />
              <div>No unit tests discovered in this solution yet.</div>
              <div className="text-[10px] text-gray-600">
                Add [Fact], [Theory], [Test], or [TestMethod] attributes or click Run All to discover via dotnet test.
              </div>
            </div>
          ) : projectGroups.length === 0 ? (
            <div className="p-4 text-center text-gray-500 space-y-2">
              <div>No tests match the active filter.</div>
              <button
                onClick={() => {
                  setStatusFilter('all');
                  setSearchFilter('');
                }}
                className="px-2.5 py-1 rounded bg-[#2b2d30] hover:bg-[#35373c] text-blue-300 text-[11px]"
              >
                Reset Filters
              </button>
            </div>
          ) : (
            projectGroups.map(project => {
              const forceExpand = statusFilter !== 'all' || searchFilter.trim().length > 0;
              const isProjectExpanded = forceExpand || expandedProjects[project.projectName] !== false;
              const projStats = fullParentStats.byProject.get(project.projectName) || summarizeTests(project.tests);

              return (
                <div key={project.projectName} className="space-y-0.5">
                  {/* Project Parent Node */}
                  <div
                    onClick={() =>
                      setExpandedProjects(prev => ({
                        ...prev,
                        [project.projectName]: !isProjectExpanded
                      }))
                    }
                    className={`flex items-center justify-between py-1 px-1.5 rounded cursor-pointer group border-l-2 ${
                      projStats.failed > 0
                        ? 'border-red-500/80 bg-red-500/5 hover:bg-red-500/10'
                        : projStats.skipped > 0
                          ? 'border-amber-400/70 bg-amber-500/5 hover:bg-amber-500/10'
                          : 'border-transparent hover:bg-[#2b2d30]'
                    }`}
                  >
                    <div className="flex items-center space-x-1.5 min-w-0 flex-1 pr-1">
                      {isProjectExpanded ? (
                        <ChevronDown className="w-3 h-3 text-gray-400 shrink-0" />
                      ) : (
                        <ChevronRight className="w-3 h-3 text-gray-400 shrink-0" />
                      )}
                      {renderRolledUpIcon(projStats)}
                      <FolderGit2 className="w-3.5 h-3.5 text-sky-400 shrink-0" />
                      <span className="font-semibold text-slate-100 truncate text-[11px]">
                        {project.projectName}
                      </span>
                    </div>

                    <div className="flex items-center space-x-1 shrink-0">
                      {renderParentBadges(projStats)}
                      {onRunTestGroup && (
                        <button
                          onClick={e => {
                            e.stopPropagation();
                            onRunTestGroup({ projectName: project.projectName });
                          }}
                          disabled={isRunningTests}
                          className="p-0.5 rounded opacity-0 group-hover:opacity-100 hover:bg-[#35373c] text-gray-300 hover:text-white transition"
                          title={`Run all tests in ${project.projectName}`}
                        >
                          <Play className="w-2.5 h-2.5 fill-current" />
                        </button>
                      )}
                    </div>
                  </div>

                  {/* Classes inside Project */}
                  {isProjectExpanded && (
                    <div className="pl-3 space-y-0.5 border-l border-[#2b2d30] ml-2.5">
                      {project.classes.map(cls => {
                        const classKey = `${project.projectName}::${cls.className}`;
                        const isClassExpanded = forceExpand || expandedClasses[classKey] !== false;
                        const clsStats = fullParentStats.byClass.get(classKey) || summarizeTests(cls.tests);

                        return (
                          <div key={classKey} className="space-y-0.5">
                            {/* Class Parent Node */}
                            <div
                              onClick={() =>
                                setExpandedClasses(prev => ({
                                  ...prev,
                                  [classKey]: !isClassExpanded
                                }))
                              }
                              className={`flex items-center justify-between py-1 px-1.5 rounded cursor-pointer group border-l-2 ${
                                clsStats.failed > 0
                                  ? 'border-red-500/70 bg-red-500/5 hover:bg-red-500/10'
                                  : clsStats.skipped > 0
                                    ? 'border-amber-400/60 bg-amber-500/5 hover:bg-amber-500/10'
                                    : 'border-transparent hover:bg-[#2b2d30]'
                              }`}
                            >
                              <div className="flex items-center space-x-1.5 min-w-0 flex-1 pr-1">
                                {isClassExpanded ? (
                                  <ChevronDown className="w-3 h-3 text-gray-400 shrink-0" />
                                ) : (
                                  <ChevronRight className="w-3 h-3 text-gray-400 shrink-0" />
                                )}
                                {renderRolledUpIcon(clsStats)}
                                <FlaskConical className="w-3 h-3 text-purple-400 shrink-0" />
                                <span className="font-medium text-slate-200 truncate text-[11px]">
                                  {cls.className}
                                </span>
                              </div>

                              <div className="flex items-center space-x-1 shrink-0">
                                {renderParentBadges(clsStats)}
                                {onRunTestGroup && (
                                  <button
                                    onClick={e => {
                                      e.stopPropagation();
                                      onRunTestGroup({
                                        projectName: project.projectName,
                                        className: cls.className,
                                        namespace: cls.namespace
                                      });
                                    }}
                                    disabled={isRunningTests}
                                    className="p-0.5 rounded opacity-0 group-hover:opacity-100 hover:bg-[#35373c] text-gray-300 hover:text-white transition"
                                    title={`Run tests in ${cls.className}`}
                                  >
                                    <Play className="w-2.5 h-2.5 fill-current" />
                                  </button>
                                )}
                              </div>
                            </div>

                            {/* Individual Test Methods */}
                            {isClassExpanded && (
                              <div className="pl-3.5 space-y-0.5 border-l border-[#2b2d30] ml-2.5">
                                {cls.tests.map(test => {
                                  const isSelected = selectedTestId === test.id;
                                  const inlineHint =
                                    test.status === 'failed'
                                      ? (test.errorMessage || '').split(/\r?\n/)[0]
                                      : test.status === 'skipped'
                                        ? test.skipReason || 'Skipped'
                                        : '';

                                  return (
                                    <div
                                      key={test.id}
                                      onClick={() => {
                                        setSelectedTestId(test.id);
                                        onNavigateToTest(test);
                                      }}
                                      className={`py-1 px-1.5 rounded cursor-pointer transition group ${
                                        isSelected
                                          ? 'bg-[#3574f0]/25 text-blue-200 ring-1 ring-blue-500/40'
                                          : test.status === 'failed'
                                            ? 'hover:bg-red-500/10 text-red-100'
                                            : test.status === 'skipped'
                                              ? 'hover:bg-amber-500/10 text-amber-100'
                                              : 'hover:bg-[#2b2d30] text-[#bcbec4]'
                                      }`}
                                    >
                                      <div className="flex items-center justify-between gap-1">
                                        <div className="flex items-center space-x-1.5 min-w-0 flex-1">
                                          {renderTestStatusIcon(test.status)}
                                          <span className="truncate text-[11px] font-medium">
                                            {test.methodName}
                                          </span>
                                        </div>

                                        <div className="flex items-center space-x-1 shrink-0">
                                          {test.durationMs !== undefined && (
                                            <span className="text-[10px] text-gray-500 font-mono">
                                              {test.durationMs}ms
                                            </span>
                                          )}
                                          <button
                                            onClick={e => {
                                              e.stopPropagation();
                                              onRunTest(test);
                                            }}
                                            disabled={isRunningTests}
                                            className="p-0.5 hover:bg-[#35373c] rounded text-gray-400 hover:text-white"
                                            title="Run Test"
                                          >
                                            <Play className="w-2.5 h-2.5 fill-current" />
                                          </button>
                                          <button
                                            onClick={e => {
                                              e.stopPropagation();
                                              onDebugTest(test);
                                            }}
                                            className="p-0.5 hover:bg-[#35373c] rounded text-gray-400 hover:text-purple-400"
                                            title="Debug Test"
                                          >
                                            <Bug className="w-2.5 h-2.5" />
                                          </button>
                                        </div>
                                      </div>

                                      {inlineHint && (
                                        <div
                                          className={`pl-5 pr-1 text-[10px] truncate mt-0.5 ${
                                            test.status === 'failed' ? 'text-red-300/80' : 'text-amber-300/80'
                                          }`}
                                          title={inlineHint}
                                        >
                                          {inlineHint}
                                        </div>
                                      )}
                                    </div>
                                  );
                                })}
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              );
            })
          )}
        </div>
      )}

      {/* Bottom Test Details & Failure Understanding Inspector */}
      <div
        className={`border-t border-[#2b2d30] bg-[#18191c] flex flex-col shrink-0 ${
          isInspectorExpanded ? 'flex-1 min-h-0' : 'h-[45%] min-h-[190px]'
        }`}
      >
        {/* Inspector Header Bar */}
        <div className="h-7 px-2.5 bg-[#212327] border-b border-[#2b2d30] flex items-center justify-between shrink-0">
          <span className="text-[10px] uppercase font-bold tracking-wider text-gray-400">
            Test Details & Diagnostics
          </span>
          <div className="flex items-center space-x-1">
            {selectedTest && selectedTest.status === 'failed' && (
              <button
                onClick={() =>
                  handleCopy(
                    'failure',
                    [
                      `Test: ${selectedTest.fullName}`,
                      `Project: ${selectedTest.projectName}`,
                      selectedTest.filePath
                        ? `Source: ${selectedTest.filePath}${selectedTest.line ? `:${selectedTest.line}` : ''}`
                        : '',
                      parsedExpectedActual.expectedValue !== undefined
                        ? `Expected: ${parsedExpectedActual.expectedValue}`
                        : '',
                      parsedExpectedActual.actualValue !== undefined
                        ? `Actual: ${parsedExpectedActual.actualValue}`
                        : '',
                      selectedTest.errorMessage ? `\nError Message:\n${selectedTest.errorMessage}` : '',
                      selectedTest.stackTrace ? `\nStack Trace:\n${selectedTest.stackTrace}` : '',
                      selectedTest.standardOutput ? `\nStandard Output:\n${selectedTest.standardOutput}` : ''
                    ]
                      .filter(Boolean)
                      .join('\n')
                  )
                }
                className="flex items-center space-x-1 px-1.5 py-0.5 rounded bg-[#2b2d30] hover:bg-[#35373c] text-[10px] text-slate-200"
                title="Copy full failure details"
              >
                {copiedKey === 'failure' ? (
                  <Check className="w-2.5 h-2.5 text-emerald-400" />
                ) : (
                  <Copy className="w-2.5 h-2.5 text-gray-400" />
                )}
                <span>{copiedKey === 'failure' ? 'Copied' : 'Copy'}</span>
              </button>
            )}
            <button
              onClick={() => setIsInspectorExpanded(v => !v)}
              className="p-0.5 rounded hover:bg-[#2b2d30] text-gray-400 hover:text-white"
              title={isInspectorExpanded ? 'Restore split view' : 'Maximize diagnostics panel'}
            >
              {isInspectorExpanded ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronUp className="w-3.5 h-3.5" />}
            </button>
          </div>
        </div>

        {/* Inspector Scrollable Body */}
        <div className="flex-1 overflow-y-auto p-2.5 space-y-2.5 select-text">
          {!selectedTest ? (
            <div className="text-gray-500 italic text-[11px] py-4 text-center">
              Select a test case above to inspect results, assertions, stack trace, and output.
            </div>
          ) : (
            <>
              {/* Title + Status Pill */}
              <div className="space-y-1">
                <div className="flex items-center justify-between gap-2 flex-wrap">
                  <div className="flex items-center space-x-1.5">
                    {selectedTest.status === 'passed' && (
                      <span className="bg-emerald-500/20 text-emerald-300 text-[10px] font-bold px-2 py-0.5 rounded border border-emerald-500/30 flex items-center space-x-1">
                        <CheckCircle2 className="w-3 h-3" />
                        <span>PASSED</span>
                      </span>
                    )}
                    {selectedTest.status === 'failed' && (
                      <span className="bg-red-500/20 text-red-300 text-[10px] font-bold px-2 py-0.5 rounded border border-red-500/40 flex items-center space-x-1">
                        <XCircle className="w-3 h-3" />
                        <span>FAILED</span>
                      </span>
                    )}
                    {selectedTest.status === 'skipped' && (
                      <span className="bg-amber-500/20 text-amber-300 text-[10px] font-bold px-2 py-0.5 rounded border border-amber-500/40 flex items-center space-x-1">
                        <SkipForward className="w-3 h-3" />
                        <span>SKIPPED</span>
                      </span>
                    )}
                    {selectedTest.status === 'running' && (
                      <span className="bg-blue-500/20 text-blue-300 text-[10px] font-bold px-2 py-0.5 rounded border border-blue-500/40 flex items-center space-x-1">
                        <RotateCw className="w-3 h-3 animate-spin" />
                        <span>RUNNING</span>
                      </span>
                    )}
                    {selectedTest.status === 'idle' && (
                      <span className="bg-slate-600/20 text-slate-300 text-[10px] font-bold px-2 py-0.5 rounded border border-slate-500/30">
                        NOT RUN
                      </span>
                    )}

                    {selectedTest.framework && selectedTest.framework !== 'Unknown' && (
                      <span className="text-[10px] px-1.5 py-0.5 rounded bg-[#26282b] text-gray-300 border border-[#32353b]">
                        {selectedTest.framework}
                      </span>
                    )}

                    {selectedTest.durationMs !== undefined && (
                      <span className="font-mono text-gray-400 text-[10px]">
                        {selectedTest.durationMs} ms
                      </span>
                    )}
                  </div>

                  <div className="flex items-center space-x-1">
                    <button
                      onClick={() => onRunTest(selectedTest)}
                      disabled={isRunningTests}
                      className="flex items-center space-x-1 px-2 py-0.5 bg-blue-600 hover:bg-blue-500 text-white rounded text-[10px] font-medium transition disabled:opacity-40"
                    >
                      <Play className="w-2.5 h-2.5 fill-current" />
                      <span>Run</span>
                    </button>
                    <button
                      onClick={() => onDebugTest(selectedTest)}
                      className="flex items-center space-x-1 px-2 py-0.5 bg-purple-600 hover:bg-purple-500 text-white rounded text-[10px] font-medium transition"
                    >
                      <Bug className="w-2.5 h-2.5" />
                      <span>Debug</span>
                    </button>
                  </div>
                </div>

                <div className="font-semibold text-slate-100 text-xs break-all">
                  {selectedTest.methodName}
                </div>

                <div className="flex items-center justify-between gap-2 text-[10px] text-gray-400">
                  <span className="font-mono truncate">
                    {selectedTest.projectName} › {selectedTest.namespace ? `${selectedTest.namespace}.` : ''}
                    {selectedTest.className}
                  </span>
                  {selectedTest.filePath && (
                    <button
                      onClick={() =>
                        onNavigateToLocation
                          ? onNavigateToLocation(selectedTest.filePath!, selectedTest.line || 1)
                          : onNavigateToTest(selectedTest)
                      }
                      className="text-blue-400 hover:text-blue-300 hover:underline flex items-center space-x-0.5 shrink-0 font-mono"
                      title={`Open ${selectedTest.filePath}:${selectedTest.line || 1}`}
                    >
                      <span>
                        {selectedTest.filePath.split(/[\\/]/).pop()}
                        {selectedTest.line ? `:${selectedTest.line}` : ''}
                      </span>
                      <ExternalLink className="w-2.5 h-2.5" />
                    </button>
                  )}
                </div>
              </div>

              {/* FAILED: Assertion Diff (Expected vs Actual) */}
              {selectedTest.status === 'failed' &&
                (parsedExpectedActual.expectedValue !== undefined ||
                  parsedExpectedActual.actualValue !== undefined) && (
                  <div className="rounded border border-red-500/30 bg-[#1e1f22] overflow-hidden">
                    <div className="px-2 py-1 bg-red-500/15 border-b border-red-500/20 text-[10px] font-bold uppercase tracking-wider text-red-300">
                      Assertion Diff
                    </div>
                    <div className="p-2 space-y-1.5 font-mono text-[11px]">
                      <div className="flex items-start gap-2 bg-emerald-500/10 border border-emerald-500/20 rounded px-2 py-1">
                        <span className="text-emerald-400 font-semibold shrink-0 w-16">Expected:</span>
                        <span className="text-emerald-200 break-all whitespace-pre-wrap">
                          {parsedExpectedActual.expectedValue ?? '(empty)'}
                        </span>
                      </div>
                      <div className="flex items-start gap-2 bg-red-500/10 border border-red-500/20 rounded px-2 py-1">
                        <span className="text-red-400 font-semibold shrink-0 w-16">Actual:</span>
                        <span className="text-red-200 break-all whitespace-pre-wrap">
                          {parsedExpectedActual.actualValue ?? '(empty)'}
                        </span>
                      </div>
                    </div>
                  </div>
                )}

              {/* FAILED: Full Error Message */}
              {selectedTest.status === 'failed' && (
                <div className="space-y-1">
                  <div className="text-[10px] uppercase font-bold tracking-wider text-red-400">
                    Failure Reason / Error Message
                  </div>
                  <pre className="bg-red-950/25 border border-red-500/30 rounded p-2 font-mono text-[11px] text-red-200 whitespace-pre-wrap break-words leading-relaxed">
                    {selectedTest.errorMessage || 'Test failed without an explicit assertion message. Check terminal output.'}
                  </pre>
                </div>
              )}

              {/* FAILED: Clickable Stack Trace */}
              {selectedTest.status === 'failed' && parsedStackFrames.length > 0 && (
                <div className="space-y-1">
                  <div className="text-[10px] uppercase font-bold tracking-wider text-gray-400">
                    Stack Trace ({parsedStackFrames.length} frames)
                  </div>
                  <div className="bg-[#1e1f22] border border-[#2b2d30] rounded p-1.5 font-mono text-[10.5px] space-y-1">
                    {parsedStackFrames.map((frame, i) => (
                      <div
                        key={i}
                        className={`rounded px-1.5 py-0.5 ${
                          frame.isUserCode ? 'bg-[#26282b] text-slate-200' : 'text-gray-500'
                        }`}
                      >
                        <div className="break-all">at {frame.methodText}</div>
                        {frame.filePath && (
                          <button
                            onClick={() =>
                              onNavigateToLocation?.(frame.filePath!, frame.line || 1)
                            }
                            className="text-blue-400 hover:text-blue-300 hover:underline flex items-center space-x-1 mt-0.5 text-[10px] text-left break-all"
                            title={`Jump to ${frame.filePath}:${frame.line || 1}`}
                          >
                            <span>
                              {frame.filePath}:{frame.line || 1}
                            </span>
                            <ExternalLink className="w-2.5 h-2.5 shrink-0" />
                          </button>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* SKIPPED: Skip Reason */}
              {selectedTest.status === 'skipped' && (
                <div className="space-y-1">
                  <div className="text-[10px] uppercase font-bold tracking-wider text-amber-400">
                    Skip Reason
                  </div>
                  <div className="bg-amber-500/10 border border-amber-500/30 rounded p-2 text-amber-200 text-[11px] whitespace-pre-wrap">
                    {selectedTest.skipReason || 'Test was skipped during execution.'}
                  </div>
                </div>
              )}

              {/* IDLE: Static metadata */}
              {selectedTest.status === 'idle' && (
                <div className="bg-[#1e1f22] border border-[#2b2d30] rounded p-2 text-[11px] text-gray-400 space-y-1">
                  <div>Ready to run in project <span className="text-slate-200">{selectedTest.projectName}</span>.</div>
                  {selectedTest.skipReason && (
                    <div className="text-amber-300">
                      Declared Skip attribute: &quot;{selectedTest.skipReason}&quot;
                    </div>
                  )}
                </div>
              )}

              {/* PASSED: Clean Summary */}
              {selectedTest.status === 'passed' && (
                <div className="bg-emerald-500/10 border border-emerald-500/25 rounded p-2 text-[11px] text-emerald-200">
                  Passed in {selectedTest.durationMs ?? 0} ms ({selectedTest.projectName}).
                </div>
              )}

              {/* Standard Output (shown whenever captured for any outcome) */}
              {selectedTest.standardOutput && (
                <div className="space-y-1">
                  <div className="text-[10px] uppercase font-bold tracking-wider text-gray-400">
                    Standard Output
                  </div>
                  <pre className="bg-[#1e1f22] border border-[#2b2d30] rounded p-2 font-mono text-[10.5px] text-slate-300 whitespace-pre-wrap break-words">
                    {selectedTest.standardOutput}
                  </pre>
                </div>
              )}
            </>
          )}
        </div>
      </div>

      {/* Full Test Report Modal */}
      {isReportModalOpen && (
        <div
          className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-4"
          onClick={() => setIsReportModalOpen(false)}
        >
          <div
            className="bg-[#1e1f22] border border-[#393b40] rounded-lg shadow-2xl w-full max-w-3xl max-h-[85vh] flex flex-col text-slate-200 overflow-hidden"
            onClick={e => e.stopPropagation()}
          >
            {/* Modal Header */}
            <div className="px-4 py-3 bg-[#26282b] border-b border-[#32353b] flex items-center justify-between">
              <div className="flex items-center space-x-2">
                <FileText className="w-4 h-4 text-blue-400" />
                <div>
                  <h3 className="font-semibold text-sm text-white">
                    Test Execution Report — {solutionName}
                  </h3>
                  <div className="text-[11px] text-gray-400">
                    Pass Rate: {overall.passRate}% ({overall.passed} passed, {overall.failed} failed,{' '}
                    {overall.skipped} skipped, {overall.durationMs} ms)
                  </div>
                </div>
              </div>
              <button
                onClick={() => setIsReportModalOpen(false)}
                className="p-1 rounded hover:bg-[#35373c] text-gray-400 hover:text-white"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* KPI Cards + Format Switcher */}
            <div className="px-4 py-3 bg-[#212327] border-b border-[#2b2d30] flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2 flex-wrap">
                <div className="px-2.5 py-1 rounded bg-[#1a1b1e] border border-[#2f3237] text-[11px]">
                  Total: <span className="font-bold text-white">{overall.total}</span>
                </div>
                <div className="px-2.5 py-1 rounded bg-emerald-500/10 border border-emerald-500/30 text-[11px] text-emerald-300">
                  Passed: <span className="font-bold">{overall.passed}</span>
                </div>
                <div className="px-2.5 py-1 rounded bg-red-500/10 border border-red-500/30 text-[11px] text-red-300">
                  Failed: <span className="font-bold">{overall.failed}</span>
                </div>
                <div className="px-2.5 py-1 rounded bg-amber-500/10 border border-amber-500/30 text-[11px] text-amber-300">
                  Skipped: <span className="font-bold">{overall.skipped}</span>
                </div>
                <div className="px-2.5 py-1 rounded bg-blue-500/10 border border-blue-500/30 text-[11px] text-blue-300">
                  Pass Rate: <span className="font-bold">{overall.passRate}%</span>
                </div>
              </div>

              <div className="flex items-center space-x-1 bg-[#18191c] p-0.5 rounded border border-[#2f3237]">
                <button
                  onClick={() => setReportFormat('markdown')}
                  className={`px-2 py-0.5 rounded text-[11px] ${
                    reportFormat === 'markdown' ? 'bg-blue-600 text-white' : 'text-gray-400 hover:text-white'
                  }`}
                >
                  Markdown
                </button>
                <button
                  onClick={() => setReportFormat('text')}
                  className={`px-2 py-0.5 rounded text-[11px] ${
                    reportFormat === 'text' ? 'bg-blue-600 text-white' : 'text-gray-400 hover:text-white'
                  }`}
                >
                  Plain Text
                </button>
              </div>
            </div>

            {/* Interactive Suite Table + Raw Preview */}
            <div className="flex-1 overflow-y-auto p-4 space-y-4 select-text">
              {/* Parent Breakdown Table */}
              <div>
                <h4 className="text-[11px] uppercase font-bold tracking-wider text-gray-400 mb-2">
                  Project & Class Breakdown
                </h4>
                <div className="border border-[#2b2d30] rounded overflow-hidden">
                  <table className="w-full text-left text-[11px] border-collapse">
                    <thead className="bg-[#26282b] text-gray-300">
                      <tr>
                        <th className="py-1.5 px-2.5 border-b border-[#32353b]">Project / Test Class</th>
                        <th className="py-1.5 px-2 border-b border-[#32353b] text-right">Passed</th>
                        <th className="py-1.5 px-2 border-b border-[#32353b] text-right">Failed</th>
                        <th className="py-1.5 px-2 border-b border-[#32353b] text-right">Skipped</th>
                        <th className="py-1.5 px-2.5 border-b border-[#32353b] text-right">Duration</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-[#26282b]">
                      {Array.from(fullParentStats.byProject.entries()).map(([projName, projStat]) => {
                        const classEntries = Array.from(fullParentStats.byClass.entries()).filter(([k]) =>
                          k.startsWith(`${projName}::`)
                        );
                        return (
                          <React.Fragment key={projName}>
                            <tr className="bg-[#212327] font-semibold">
                              <td className="py-1.5 px-2.5 flex items-center space-x-1.5">
                                {renderRolledUpIcon(projStat)}
                                <span className="text-white">{projName}</span>
                              </td>
                              <td className="py-1.5 px-2 text-right text-emerald-400">{projStat.passed}</td>
                              <td className={`py-1.5 px-2 text-right ${projStat.failed > 0 ? 'text-red-400' : 'text-gray-500'}`}>
                                {projStat.failed}
                              </td>
                              <td className={`py-1.5 px-2 text-right ${projStat.skipped > 0 ? 'text-amber-400' : 'text-gray-500'}`}>
                                {projStat.skipped}
                              </td>
                              <td className="py-1.5 px-2.5 text-right text-gray-400 font-mono">
                                {projStat.durationMs}ms
                              </td>
                            </tr>
                            {classEntries.map(([clsKey, clsStat]) => {
                              const clsName = clsKey.split('::')[1];
                              return (
                                <tr key={clsKey} className="hover:bg-[#26282b]/60">
                                  <td className="py-1 px-2.5 pl-6 flex items-center space-x-1.5">
                                    {renderRolledUpIcon(clsStat)}
                                    <span className="text-slate-300 font-mono">{clsName}</span>
                                  </td>
                                  <td className="py-1 px-2 text-right text-emerald-400">{clsStat.passed}</td>
                                  <td className={`py-1 px-2 text-right ${clsStat.failed > 0 ? 'text-red-400 font-semibold' : 'text-gray-500'}`}>
                                    {clsStat.failed}
                                  </td>
                                  <td className={`py-1 px-2 text-right ${clsStat.skipped > 0 ? 'text-amber-400 font-semibold' : 'text-gray-500'}`}>
                                    {clsStat.skipped}
                                  </td>
                                  <td className="py-1 px-2.5 text-right text-gray-400 font-mono">
                                    {clsStat.durationMs}ms
                                  </td>
                                </tr>
                              );
                            })}
                          </React.Fragment>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>

              {/* Exportable Report Text */}
              <div>
                <h4 className="text-[11px] uppercase font-bold tracking-wider text-gray-400 mb-2">
                  Shareable {reportFormat === 'markdown' ? 'Markdown' : 'Plain Text'} Report
                </h4>
                <pre className="bg-[#151619] border border-[#2b2d30] rounded p-3 font-mono text-[11px] text-slate-300 whitespace-pre-wrap break-words max-h-72 overflow-y-auto">
                  {reportContent}
                </pre>
              </div>
            </div>

            {/* Modal Footer */}
            <div className="px-4 py-2.5 bg-[#26282b] border-t border-[#32353b] flex items-center justify-end space-x-2">
              <button
                onClick={() => handleCopy('report', reportContent)}
                className="flex items-center space-x-1.5 px-3 py-1.5 rounded bg-blue-600 hover:bg-blue-500 text-white text-xs font-medium"
              >
                {copiedKey === 'report' ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
                <span>{copiedKey === 'report' ? 'Copied Report!' : 'Copy Report'}</span>
              </button>
              <button
                onClick={handleDownloadReport}
                className="flex items-center space-x-1.5 px-3 py-1.5 rounded bg-[#2f3237] hover:bg-[#3b3e45] text-slate-100 border border-[#3e4147] text-xs font-medium"
              >
                <Download className="w-3.5 h-3.5" />
                <span>Download .{reportFormat === 'markdown' ? 'md' : 'txt'}</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
