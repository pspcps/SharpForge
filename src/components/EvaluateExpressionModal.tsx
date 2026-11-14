import React, { useState, useEffect } from 'react';
import {
  X,
  Play,
  Eye,
  Pencil,
  Copy,
  Check,
  ChevronRight,
  ChevronDown,
  Terminal,
  Braces
} from 'lucide-react';
import type { VariableItem } from '../types/minirider';
import {
  buildCSharpConversionExpression,
  convertEvaluatedValueLocally,
  type ConversionFormatId,
  type EvaluatedDebugValue
} from '../utils/debugExpressionHelper';

const CONVERSION_OPTIONS: Array<{ id: ConversionFormatId; label: string }> = [
  { id: 'raw', label: 'Raw' },
  { id: 'json-pretty', label: 'JSON Pretty' },
  { id: 'json-compact', label: 'JSON Stringify' },
  { id: 'string', label: '(string)' },
  { id: 'tostring', label: 'ToString()' },
  { id: 'int', label: '(int)' },
  { id: 'long', label: '(long)' },
  { id: 'double', label: '(double)' },
  { id: 'decimal', label: '(decimal)' },
  { id: 'bool', label: '(bool)' },
  { id: 'hex', label: 'Hex' }
];

interface EvaluateExpressionModalProps {
  isOpen: boolean;
  initialExpression: string;
  initialMode?: 'evaluate' | 'setValue';
  variables?: VariableItem[];
  onClose: () => void;
  onEvaluate: (expression: string, context?: 'hover' | 'watch' | 'repl') => Promise<EvaluatedDebugValue>;
  onExpandVariables?: (variablesReference: number) => Promise<VariableItem[]>;
  onAddWatch: (expression: string) => void;
  onSetValue: (payload: {
    expression: string;
    newValue: string;
    variablesReference?: number;
    name?: string;
  }) => Promise<{ success: boolean; value?: string; error?: string }>;
}

export const EvaluateExpressionModal: React.FC<EvaluateExpressionModalProps> = ({
  isOpen,
  initialExpression,
  initialMode = 'evaluate',
  onClose,
  onEvaluate,
  onExpandVariables,
  onAddWatch,
  onSetValue
}) => {
  const [exprInput, setExprInput] = useState(initialExpression);
  const [evalResult, setEvalResult] = useState<EvaluatedDebugValue | null>(null);
  const [isEvaluating, setIsEvaluating] = useState(false);

  const [isSettingValue, setIsSettingValue] = useState(initialMode === 'setValue');
  const [newValueInput, setNewValueInput] = useState('');
  const [setStatus, setSetStatus] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const [expandedRefs, setExpandedRefs] = useState<Record<number, VariableItem[]>>({});
  const [selectedFormat, setSelectedFormat] = useState<ConversionFormatId>('raw');
  const [convertedOutput, setConvertedOutput] = useState<{ text: string; typeLabel: string } | null>(null);
  const [isConverting, setIsConverting] = useState(false);

  useEffect(() => {
    if (!isOpen) return;
    setExprInput(initialExpression);
    setIsSettingValue(initialMode === 'setValue');
    setSetStatus(null);
    setExpandedRefs({});
    setSelectedFormat('raw');
    setConvertedOutput(null);

    if (initialExpression.trim()) {
      setIsEvaluating(true);
      onEvaluate(initialExpression.trim(), 'watch')
        .then((res) => {
          setEvalResult(res);
          if (res.success) {
            setNewValueInput(res.result);
          }
        })
        .finally(() => setIsEvaluating(false));
    } else {
      setEvalResult(null);
      setNewValueInput('');
    }
  }, [isOpen, initialExpression, initialMode, onEvaluate]);

  const applyConversion = async (fmt: ConversionFormatId, currentEval: EvaluatedDebugValue | null) => {
    setSelectedFormat(fmt);
    if (!currentEval || !currentEval.success || fmt === 'raw') {
      setConvertedOutput(null);
      return;
    }

    setIsConverting(true);
    try {
      const targetExpr = currentEval.expression || exprInput.trim();
      if (targetExpr) {
        const csharpConvExpr = buildCSharpConversionExpression(targetExpr, fmt);
        const remote = await onEvaluate(csharpConvExpr, 'watch');
        if (remote && remote.success && remote.result && !remote.result.toLowerCase().includes('does not exist')) {
          let cleaned = remote.result;
          // Unescape C# serialized JSON string literal for readability
          if ((fmt === 'json-pretty' || fmt === 'json-compact') && cleaned.startsWith('"') && cleaned.endsWith('"')) {
            try {
              const parsedStr = JSON.parse(cleaned);
              if (typeof parsedStr === 'string') cleaned = parsedStr;
            } catch {}
          }
          setConvertedOutput({ text: cleaned, typeLabel: remote.type || fmt });
          return;
        }
      }

      const local = await convertEvaluatedValueLocally(currentEval, fmt, onExpandVariables);
      setConvertedOutput({ text: local.formatted, typeLabel: local.typeLabel });
    } finally {
      setIsConverting(false);
    }
  };

  if (!isOpen) return null;

  const runEvaluate = async (e?: React.FormEvent) => {
    e?.preventDefault();
    const clean = exprInput.trim();
    if (!clean) return;
    setIsEvaluating(true);
    setSetStatus(null);
    try {
      const res = await onEvaluate(clean, 'watch');
      setEvalResult(res);
      if (res.success) {
        setNewValueInput(res.result);
        if (selectedFormat !== 'raw') {
          await applyConversion(selectedFormat, res);
        } else {
          setConvertedOutput(null);
        }
      } else {
        setConvertedOutput(null);
      }
    } finally {
      setIsEvaluating(false);
    }
  };

  const handleApplySetValue = async (e: React.FormEvent) => {
    e.preventDefault();
    const targetExpr = exprInput.trim();
    if (!targetExpr) return;
    setSetStatus(null);
    const res = await onSetValue({
      expression: targetExpr,
      newValue: newValueInput
    });
    if (res.success) {
      setSetStatus(`Updated ${targetExpr} = ${res.value ?? newValueInput}`);
      setIsSettingValue(false);
      await runEvaluate();
    } else {
      setSetStatus(`Error: ${res.error || 'Could not modify value at runtime'}`);
    }
  };

  const toggleExpandRef = async (refId: number) => {
    if (!refId || refId <= 0) return;
    if (expandedRefs[refId]) {
      const clone = { ...expandedRefs };
      delete clone[refId];
      setExpandedRefs(clone);
      return;
    }
    if (onExpandVariables) {
      const children = await onExpandVariables(refId);
      setExpandedRefs(prev => ({ ...prev, [refId]: children }));
    }
  };

  const renderChildList = (items: VariableItem[], depth = 0) =>
    items.map((item, idx) => {
      const refId = item.variablesReference || 0;
      const children = item.children || expandedRefs[refId];
      const hasChildren = Boolean((item.children && item.children.length > 0) || refId > 0);
      const isOpenNode = Boolean(children && (item.children || expandedRefs[refId]));

      return (
        <div key={`${item.name}-${idx}`} className="space-y-0.5">
          <div
            onClick={() => (refId > 0 ? toggleExpandRef(refId) : undefined)}
            style={{ paddingLeft: `${depth * 14 + 8}px` }}
            className={`flex items-center space-x-1.5 py-0.5 pr-2 rounded hover:bg-[#2b2d30] ${
              hasChildren ? 'cursor-pointer' : ''
            }`}
          >
            {hasChildren ? (
              isOpenNode ? (
                <ChevronDown className="w-3 h-3 text-gray-400 shrink-0" />
              ) : (
                <ChevronRight className="w-3 h-3 text-gray-400 shrink-0" />
              )
            ) : (
              <span className="w-3 shrink-0" />
            )}
            <span className="text-[#c77dbb] font-semibold shrink-0">{item.name}</span>
            <span className="text-gray-500">=</span>
            <span className="text-[#6aab73] truncate">{item.value}</span>
            <span className="text-[10px] text-gray-500 shrink-0">({item.type})</span>
          </div>
          {isOpenNode && children && renderChildList(children, depth + 1)}
        </div>
      );
    });

  return (
    <div
      className="fixed inset-0 z-50 bg-black/60 backdrop-blur-[1px] flex items-center justify-center p-4 select-none"
      onClick={onClose}
    >
      <div
        className="w-full max-w-xl bg-[#26282b] border border-[#393b40] rounded-xl shadow-2xl overflow-hidden text-xs text-[#dfe1e5]"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="h-10 bg-[#2b2d30] border-b border-[#1e1f22] px-4 flex items-center justify-between">
          <div className="flex items-center space-x-2 font-semibold text-sm text-white">
            <Terminal className="w-4 h-4 text-purple-400" />
            <span>{isSettingValue ? 'Set Value & Evaluate' : 'Evaluate Expression'}</span>
            <kbd className="text-[10px] bg-[#1e1f22] text-gray-400 px-1.5 py-0.5 rounded font-mono">
              ⌥F8
            </kbd>
          </div>
          <button
            onClick={onClose}
            className="p-1 rounded hover:bg-[#35373c] text-gray-400 hover:text-white"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-4 space-y-3">
          {/* Expression Input */}
          <form onSubmit={runEvaluate} className="space-y-1.5">
            <label className="text-[11px] font-medium text-gray-400">Expression</label>
            <div className="flex items-center space-x-2">
              <input
                type="text"
                autoFocus
                value={exprInput}
                onChange={(e) => setExprInput(e.target.value)}
                placeholder="e.g. id, user.Email, user == null, items.Count"
                className="flex-1 bg-[#1e1f22] border border-[#393b40] rounded-md px-3 py-1.5 text-white font-mono text-xs focus:outline-none focus:border-[#3574f0]"
              />
              <button
                type="submit"
                disabled={isEvaluating}
                className="bg-[#3574f0] hover:bg-[#2c66db] text-white px-3 py-1.5 rounded-md font-medium flex items-center space-x-1.5 transition shrink-0"
              >
                <Play className="w-3.5 h-3.5 fill-current" />
                <span>{isEvaluating ? 'Evaluating...' : 'Evaluate'}</span>
              </button>
            </div>
          </form>

          {/* Type Conversion & JSON Stringify Bar */}
          <div className="space-y-1">
            <div className="flex items-center justify-between text-[11px] text-gray-400">
              <span className="flex items-center space-x-1 font-medium">
                <Braces className="w-3 h-3 text-emerald-400" />
                <span>Type Conversion / Format</span>
              </span>
              {convertedOutput && (
                <span className="text-[10px] font-mono text-emerald-300">
                  Converted as {convertedOutput.typeLabel}
                </span>
              )}
            </div>
            <div className="flex items-center flex-wrap gap-1">
              {CONVERSION_OPTIONS.map((opt) => (
                <button
                  key={opt.id}
                  type="button"
                  disabled={!evalResult?.success || isEvaluating}
                  onClick={() => applyConversion(opt.id, evalResult)}
                  className={`px-2 py-0.5 rounded text-[10px] font-mono border transition disabled:opacity-40 ${
                    selectedFormat === opt.id
                      ? 'bg-[#3574f0] border-[#3574f0] text-white font-semibold'
                      : 'bg-[#1e1f22] border-[#393b40] text-gray-300 hover:text-white hover:border-[#4e5157]'
                  }`}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </div>

          {/* Runtime Evaluation Result */}
          <div className="bg-[#1e1f22] border border-[#393b40] rounded-lg p-3 space-y-2 min-h-[120px] max-h-72 overflow-y-auto font-mono">
            {isEvaluating || isConverting ? (
              <div className="text-gray-400 italic font-sans">
                {isConverting ? `Converting output (${selectedFormat})...` : 'Evaluating in current stack frame...'}
              </div>
            ) : !evalResult ? (
              <div className="text-gray-500 italic font-sans">
                Enter any local variable, object property, or C# expression and press Enter.
              </div>
            ) : !evalResult.success ? (
              <div className="text-red-400">{evalResult.result}</div>
            ) : (
              <div className="space-y-2">
                <div className="flex items-start justify-between gap-2">
                  <div className="flex items-center flex-wrap gap-1.5 min-w-0">
                    {((evalResult.variablesReference && evalResult.variablesReference > 0) ||
                      (evalResult.children && evalResult.children.length > 0)) && (
                      <button
                        type="button"
                        onClick={() =>
                          evalResult.variablesReference
                            ? toggleExpandRef(evalResult.variablesReference)
                            : undefined
                        }
                        className="text-gray-400 hover:text-white"
                      >
                        {evalResult.variablesReference && expandedRefs[evalResult.variablesReference] ? (
                          <ChevronDown className="w-3.5 h-3.5" />
                        ) : (
                          <ChevronRight className="w-3.5 h-3.5" />
                        )}
                      </button>
                    )}
                    <span className="text-sky-300 font-semibold">{evalResult.expression}</span>
                    <span className="text-gray-500">=</span>
                    <span className="text-emerald-400 break-all">{evalResult.result}</span>
                    {evalResult.type && (
                      <span className="text-[10px] bg-[#2b2d30] text-gray-400 px-1.5 py-0.5 rounded">
                        {evalResult.type}
                      </span>
                    )}
                  </div>

                  <button
                    type="button"
                    onClick={() => {
                      const txtToCopy = convertedOutput ? convertedOutput.text : evalResult.result;
                      navigator.clipboard?.writeText(txtToCopy);
                      setCopied(true);
                      setTimeout(() => setCopied(false), 1200);
                    }}
                    className="flex items-center space-x-1 px-2 py-0.5 rounded bg-[#26282b] hover:bg-[#35373c] border border-[#393b40] text-gray-300 hover:text-white shrink-0 text-[10px] font-sans"
                    title="Copy Evaluated / Converted Output"
                  >
                    {copied ? <Check className="w-3 h-3 text-emerald-400" /> : <Copy className="w-3 h-3" />}
                    <span>{copied ? 'Copied' : convertedOutput ? 'Copy Output' : 'Copy'}</span>
                  </button>
                </div>

                {convertedOutput && selectedFormat !== 'raw' && (
                  <pre className="bg-[#18191c] border border-emerald-500/30 rounded p-2.5 text-[11px] text-emerald-300 whitespace-pre-wrap break-all select-text max-h-48 overflow-y-auto">
                    {convertedOutput.text}
                  </pre>
                )}

                {evalResult.children && renderChildList(evalResult.children, 1)}
                {evalResult.variablesReference &&
                  expandedRefs[evalResult.variablesReference] &&
                  renderChildList(expandedRefs[evalResult.variablesReference], 1)}
              </div>
            )}
          </div>

          {/* Runtime Change Value Section */}
          {isSettingValue && (
            <form
              onSubmit={handleApplySetValue}
              className="bg-amber-500/10 border border-amber-500/30 rounded-lg p-3 space-y-2"
            >
              <div className="flex items-center justify-between text-[11px] text-amber-200 font-medium">
                <span>Change Variable Value at Runtime</span>
                <span className="font-mono text-gray-400">{exprInput}</span>
              </div>
              <div className="flex items-center space-x-2">
                <input
                  type="text"
                  autoFocus
                  value={newValueInput}
                  onChange={(e) => setNewValueInput(e.target.value)}
                  placeholder='Enter new C# value (e.g. 99 or "Alice" or true)'
                  className="flex-1 bg-[#1e1f22] border border-amber-500/40 rounded px-2.5 py-1.5 text-white font-mono text-xs focus:outline-none focus:border-amber-400"
                />
                <button
                  type="submit"
                  className="bg-amber-500 hover:bg-amber-400 text-black font-semibold px-3 py-1.5 rounded transition shrink-0"
                >
                  Apply Value
                </button>
              </div>
            </form>
          )}

          {setStatus && (
            <div
              className={`text-[11px] font-mono px-2.5 py-1.5 rounded ${
                setStatus.startsWith('Error:')
                  ? 'bg-red-500/15 text-red-300 border border-red-500/30'
                  : 'bg-emerald-500/15 text-emerald-300 border border-emerald-500/30'
              }`}
            >
              {setStatus}
            </div>
          )}

          {/* Footer Action Buttons */}
          <div className="flex items-center justify-between pt-1">
            <div className="flex items-center space-x-2">
              <button
                type="button"
                onClick={() => {
                  if (exprInput.trim()) {
                    onAddWatch(exprInput.trim());
                  }
                }}
                className="flex items-center space-x-1.5 px-3 py-1.5 rounded-md bg-[#2b2d30] hover:bg-[#35373c] border border-[#393b40] text-sky-300 font-medium transition"
              >
                <Eye className="w-3.5 h-3.5" />
                <span>Add to Watches</span>
              </button>

              <button
                type="button"
                onClick={() => setIsSettingValue(prev => !prev)}
                className={`flex items-center space-x-1.5 px-3 py-1.5 rounded-md border font-medium transition ${
                  isSettingValue
                    ? 'bg-amber-500/20 border-amber-500/40 text-amber-300'
                    : 'bg-[#2b2d30] hover:bg-[#35373c] border-[#393b40] text-amber-300'
                }`}
              >
                <Pencil className="w-3.5 h-3.5" />
                <span>Set Value...</span>
              </button>
            </div>

            <button
              type="button"
              onClick={onClose}
              className="px-3 py-1.5 rounded-md bg-[#1e1f22] hover:bg-[#2b2d30] border border-[#393b40] text-gray-300 transition"
            >
              Close
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
