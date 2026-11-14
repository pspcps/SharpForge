import React, { useState } from 'react';
import { X, Copy, Check, Globe, AlertTriangle, Terminal } from 'lucide-react';
import type { DetectedHttpCall, GeneratedCurlResult } from '../utils/curlGenerator';

interface CurlPreviewModalProps {
  isOpen: boolean;
  onClose: () => void;
  curlData: GeneratedCurlResult | null;
  detectedCall: DetectedHttpCall | null;
  isGenerating?: boolean;
  error?: string | null;
}

export const CurlPreviewModal: React.FC<CurlPreviewModalProps> = ({
  isOpen,
  onClose,
  curlData,
  detectedCall,
  isGenerating = false,
  error = null
}) => {
  const [formatStyle, setFormatStyle] = useState<'multiline' | 'single'>('multiline');
  const [copiedMode, setCopiedMode] = useState<'single' | 'multi' | null>(null);

  if (!isOpen) return null;

  const copyCommand = (mode: 'single' | 'multi') => {
    if (!curlData) return;
    const txt = mode === 'single' ? curlData.curlCommand : curlData.multilineCurlCommand;
    navigator.clipboard?.writeText(txt);
    setCopiedMode(mode);
    setTimeout(() => setCopiedMode(null), 1500);
  };

  const methodBadgeColor = (m?: string) => {
    switch (m) {
      case 'GET': return 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40';
      case 'POST': return 'bg-amber-500/20 text-amber-300 border-amber-500/40';
      case 'PUT': return 'bg-sky-500/20 text-sky-300 border-sky-500/40';
      case 'DELETE': return 'bg-red-500/20 text-red-300 border-red-500/40';
      case 'PATCH': return 'bg-purple-500/20 text-purple-300 border-purple-500/40';
      default: return 'bg-slate-500/20 text-slate-300 border-slate-500/40';
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 bg-black/60 backdrop-blur-[1px] flex items-center justify-center p-4 select-none"
      onClick={onClose}
    >
      <div
        className="w-full max-w-2xl bg-[#26282b] border border-[#393b40] rounded-xl shadow-2xl overflow-hidden text-xs text-[#dfe1e5]"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="h-11 bg-[#2b2d30] border-b border-[#1e1f22] px-4 flex items-center justify-between">
          <div className="flex items-center space-x-2 font-semibold text-sm text-white">
            <Globe className="w-4 h-4 text-emerald-400" />
            <span>HTTP Request &rarr; Copy as cURL</span>
            {curlData && (
              <span className={`text-[11px] font-mono px-2 py-0.5 rounded border font-bold ${methodBadgeColor(curlData.method)}`}>
                {curlData.method}
              </span>
            )}
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1 rounded hover:bg-[#35373c] text-gray-400 hover:text-white"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-4 space-y-3 max-h-[80vh] overflow-y-auto">
          {isGenerating ? (
            <div className="py-8 text-center text-gray-400 font-mono">
              Resolving runtime URL template, parameters, and auth headers from current debug frame...
            </div>
          ) : error ? (
            <div className="bg-red-500/10 border border-red-500/30 rounded-lg p-3 text-red-300 space-y-1">
              <div className="font-semibold">Could not generate cURL from current line</div>
              <div className="text-[11px] text-red-200/80">{error}</div>
            </div>
          ) : curlData ? (
            <>
              {/* Resolved Endpoint Preview */}
              <div className="space-y-1">
                <div className="text-[11px] text-gray-400 font-medium">Resolved Endpoint URL</div>
                <div className="bg-[#18191c] border border-[#393b40] rounded px-3 py-2 font-mono text-emerald-300 break-all select-text">
                  {curlData.resolvedUrl}
                </div>
              </div>

              {curlData.warnings.length > 0 && (
                <div className="bg-amber-500/10 border border-amber-500/30 rounded-lg p-2.5 space-y-1 text-amber-200">
                  <div className="flex items-center space-x-1.5 font-semibold text-[11px]">
                    <AlertTriangle className="w-3.5 h-3.5 text-amber-400" />
                    <span>Partial Runtime Evaluation Notes</span>
                  </div>
                  {curlData.warnings.map((w, i) => (
                    <div key={i} className="text-[11px] text-amber-200/80 font-mono">
                      • {w}
                    </div>
                  ))}
                </div>
              )}

              {/* Query Params + Headers Grid */}
              {(Object.keys(curlData.queryParams).length > 0 || Object.keys(curlData.headers).length > 0) && (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  {Object.keys(curlData.queryParams).length > 0 && (
                    <div className="bg-[#1e1f22] border border-[#393b40] rounded-lg p-2.5 space-y-1.5">
                      <div className="text-[10px] uppercase font-bold text-gray-400 tracking-wider">
                        Query Parameters ({Object.keys(curlData.queryParams).length})
                      </div>
                      <div className="space-y-1 font-mono text-[11px] max-h-32 overflow-y-auto">
                        {Object.entries(curlData.queryParams).map(([k, v]) => (
                          <div key={k} className="flex items-center justify-between gap-2">
                            <span className="text-sky-300 truncate">{k}</span>
                            <span className="text-emerald-300 truncate">{v}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {Object.keys(curlData.headers).length > 0 && (
                    <div className="bg-[#1e1f22] border border-[#393b40] rounded-lg p-2.5 space-y-1.5">
                      <div className="text-[10px] uppercase font-bold text-gray-400 tracking-wider">
                        Resolved Headers ({Object.keys(curlData.headers).length})
                      </div>
                      <div className="space-y-1 font-mono text-[11px] max-h-32 overflow-y-auto">
                        {Object.entries(curlData.headers).map(([k, v]) => (
                          <div key={k} className="flex items-center justify-between gap-2">
                            <span className="text-[#c77dbb] shrink-0">{k}</span>
                            <span className="text-slate-300 truncate" title={v}>{v}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* Request Body JSON if POST/PUT/PATCH */}
              {curlData.bodyJson && (
                <div className="space-y-1">
                  <div className="text-[11px] text-gray-400 font-medium">Request JSON Body</div>
                  <pre className="bg-[#18191c] border border-[#393b40] rounded p-2.5 font-mono text-[11px] text-amber-200 max-h-36 overflow-y-auto select-text">
                    {curlData.bodyJson}
                  </pre>
                </div>
              )}

              {/* Generated cURL Output */}
              <div className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <div className="flex items-center space-x-1.5 text-[11px] text-gray-300 font-medium">
                    <Terminal className="w-3.5 h-3.5 text-sky-400" />
                    <span>Generated cURL Command</span>
                  </div>
                  <div className="flex items-center bg-[#1e1f22] border border-[#393b40] rounded p-0.5 text-[10px]">
                    <button
                      type="button"
                      onClick={() => setFormatStyle('multiline')}
                      className={`px-2 py-0.5 rounded transition ${
                        formatStyle === 'multiline' ? 'bg-[#3574f0] text-white' : 'text-gray-400 hover:text-white'
                      }`}
                    >
                      Multi-line
                    </button>
                    <button
                      type="button"
                      onClick={() => setFormatStyle('single')}
                      className={`px-2 py-0.5 rounded transition ${
                        formatStyle === 'single' ? 'bg-[#3574f0] text-white' : 'text-gray-400 hover:text-white'
                      }`}
                    >
                      Single-line
                    </button>
                  </div>
                </div>

                <pre className="bg-[#18191c] border border-[#393b40] rounded-lg p-3 font-mono text-[11px] text-slate-200 overflow-x-auto whitespace-pre-wrap break-all select-text">
                  {formatStyle === 'multiline' ? curlData.multilineCurlCommand : curlData.curlCommand}
                </pre>
              </div>

              {detectedCall && (
                <div className="text-[10px] font-mono text-gray-500 truncate">
                  Source call (line {detectedCall.line}): {detectedCall.rawStatement}
                </div>
              )}
            </>
          ) : null}
        </div>

        {/* Footer */}
        <div className="h-11 bg-[#2b2d30] border-t border-[#1e1f22] px-4 flex items-center justify-between">
          <div className="flex items-center space-x-2">
            {curlData && (
              <>
                <button
                  type="button"
                  onClick={() => copyCommand('single')}
                  className="flex items-center space-x-1.5 px-3 py-1.5 rounded bg-[#3574f0] hover:bg-[#2c66db] text-white font-medium transition"
                >
                  {copiedMode === 'single' ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
                  <span>{copiedMode === 'single' ? 'Copied One-Line!' : 'Copy Single-Line cURL'}</span>
                </button>
                <button
                  type="button"
                  onClick={() => copyCommand('multi')}
                  className="flex items-center space-x-1.5 px-3 py-1.5 rounded bg-[#1e1f22] hover:bg-[#35373c] border border-[#393b40] text-gray-200 font-medium transition"
                >
                  {copiedMode === 'multi' ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                  <span>{copiedMode === 'multi' ? 'Copied Multi-Line!' : 'Copy Multi-Line'}</span>
                </button>
              </>
            )}
          </div>

          <button
            type="button"
            onClick={onClose}
            className="px-3 py-1.5 rounded bg-[#1e1f22] hover:bg-[#35373c] border border-[#393b40] text-gray-300 transition"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
};
