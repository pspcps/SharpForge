import React, { useState } from 'react';
import { 
  ChevronRight, 
  Copy, 
  Scissors,
  Clipboard, 
  Layers, 
  ArrowUpRight, 
  Zap, 
  FolderSync,
  Terminal,
  Replace,
  Eye,
  Pencil,
  CircleDot,
  Sparkles,
  Braces,
  Globe
} from 'lucide-react';
import { SolutionFileItem } from '../types/minirider';

interface EditorContextMenuProps {
  x: number;
  y: number;
  onClose: () => void;
  activeFile: SolutionFileItem | null;
  onGoToImplementation: () => void;
  onGoToDefinition: () => void;
  onFindUsages: () => void;
  onOpenAppSettingsEnv?: () => void;
  onCut?: () => void;
  onCopy?: () => void;
  onPaste?: () => void;
  onChangeAllOccurrences?: () => void;
  onOpenCommandPalette?: () => void;
  isDebuggingPaused?: boolean;
  debugExpression?: string | null;
  debugPreviewValue?: string | null;
  onEvaluateExpression?: (expression: string) => void;
  onAddWatchExpression?: (expression: string) => void;
  onSetDebugValue?: (expression: string) => void;
  onCopyAsJson?: (expression: string) => void;
  onCopyAsCurl?: () => void;
  onToggleBreakpointAtCursor?: () => void;
}

export const EditorContextMenu: React.FC<EditorContextMenuProps> = ({
  x,
  y,
  onClose,
  activeFile,
  onGoToImplementation,
  onGoToDefinition,
  onFindUsages,
  onOpenAppSettingsEnv,
  onCut,
  onCopy,
  onPaste,
  onChangeAllOccurrences,
  onOpenCommandPalette,
  isDebuggingPaused = false,
  debugExpression,
  debugPreviewValue,
  onEvaluateExpression,
  onAddWatchExpression,
  onSetDebugValue,
  onCopyAsJson,
  onCopyAsCurl,
  onToggleBreakpointAtCursor
}) => {
  const [isGoToSubmenuOpen, setIsGoToSubmenuOpen] = useState(false);
  const isAppSettings = activeFile?.name.toLowerCase().includes('appsettings');

  // Prevent menu from overflowing viewport
  const menuHeightEstimate = isDebuggingPaused ? 580 : 480;
  const adjustedX = Math.max(8, Math.min(x, window.innerWidth - 310));
  const adjustedY = Math.max(8, Math.min(y, window.innerHeight - menuHeightEstimate));

  return (
    <div
      className="fixed inset-0 z-50 bg-black/5"
      onClick={onClose}
      onContextMenu={(e) => {
        e.preventDefault();
        onClose();
      }}
    >
      <div
        style={{ top: adjustedY, left: adjustedX }}
        className="absolute bg-[#26282b] border border-[#393b40] rounded-lg shadow-2xl py-1 text-xs text-[#dfe1e5] w-72 z-50 font-sans select-none animate-in fade-in zoom-in-95 duration-100"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Live Debug Inspection Actions when paused at Breakpoint */}
        {isDebuggingPaused && (
          <>
            <div className="px-3 py-1 flex items-center justify-between text-[10px] uppercase tracking-wider text-purple-300 font-bold bg-purple-500/10">
              <span>Debug Runtime {debugExpression ? `· ${debugExpression}` : ''}</span>
              {debugPreviewValue !== null && debugPreviewValue !== undefined && (
                <span className="font-mono normal-case text-emerald-300 truncate max-w-[120px]">
                  = {debugPreviewValue}
                </span>
              )}
            </div>

            <button
              onClick={() => {
                onClose();
                onEvaluateExpression?.(debugExpression || '');
              }}
              className="w-full text-left px-3 py-1.5 hover:bg-[#3574f0] hover:text-white flex items-center justify-between text-purple-200 font-semibold"
            >
              <div className="flex items-center space-x-2 min-w-0">
                <Sparkles className="w-3.5 h-3.5 text-purple-400 shrink-0" />
                <span className="truncate">
                  Evaluate {debugExpression ? `'${debugExpression}'` : 'Expression...'}
                </span>
              </div>
              <kbd className="text-[10px] text-purple-300 font-mono shrink-0 ml-2">⌥F8</kbd>
            </button>

            <button
              onClick={() => {
                onClose();
                if (debugExpression) {
                  onAddWatchExpression?.(debugExpression);
                } else {
                  onEvaluateExpression?.('');
                }
              }}
              className="w-full text-left px-3 py-1.5 hover:bg-[#3574f0] hover:text-white flex items-center justify-between text-sky-200"
            >
              <div className="flex items-center space-x-2 min-w-0">
                <Eye className="w-3.5 h-3.5 text-sky-400 shrink-0" />
                <span className="truncate">
                  Add {debugExpression ? `'${debugExpression}' ` : ''}to Watches
                </span>
              </div>
              <kbd className="text-[10px] text-gray-400 shrink-0 ml-2">Watch</kbd>
            </button>

            <button
              onClick={() => {
                onClose();
                onSetDebugValue?.(debugExpression || '');
              }}
              className="w-full text-left px-3 py-1.5 hover:bg-[#3574f0] hover:text-white flex items-center justify-between text-amber-200 font-medium"
            >
              <div className="flex items-center space-x-2 min-w-0">
                <Pencil className="w-3.5 h-3.5 text-amber-400 shrink-0" />
                <span className="truncate">
                  Change Value {debugExpression ? `('${debugExpression}')` : '...'}
                </span>
              </div>
              <kbd className="text-[10px] text-amber-300/80 shrink-0 ml-2">Runtime</kbd>
            </button>

            {debugExpression && onCopyAsJson && (
              <button
                onClick={() => {
                  onClose();
                  onCopyAsJson(debugExpression);
                }}
                className="w-full text-left px-3 py-1.5 hover:bg-[#3574f0] hover:text-white flex items-center justify-between text-emerald-300"
              >
                <div className="flex items-center space-x-2 min-w-0">
                  <Braces className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
                  <span className="truncate">Copy &apos;{debugExpression}&apos; as JSON</span>
                </div>
                <kbd className="text-[10px] text-emerald-300/80 shrink-0 ml-2">JSON</kbd>
              </button>
            )}

            {onCopyAsCurl && (
              <button
                onClick={() => {
                  onClose();
                  onCopyAsCurl();
                }}
                className="w-full text-left px-3 py-1.5 hover:bg-[#3574f0] hover:text-white flex items-center justify-between text-cyan-300"
              >
                <div className="flex items-center space-x-2 min-w-0">
                  <Globe className="w-3.5 h-3.5 text-cyan-400 shrink-0" />
                  <span className="truncate">Copy HTTP Call as cURL...</span>
                </div>
                <kbd className="text-[10px] text-cyan-300/80 shrink-0 ml-2">cURL</kbd>
              </button>
            )}

            {onToggleBreakpointAtCursor && (
              <button
                onClick={() => {
                  onClose();
                  onToggleBreakpointAtCursor();
                }}
                className="w-full text-left px-3 py-1.5 hover:bg-[#3574f0] hover:text-white flex items-center justify-between"
              >
                <div className="flex items-center space-x-2">
                  <CircleDot className="w-3.5 h-3.5 text-red-400" />
                  <span>Toggle Breakpoint</span>
                </div>
                <kbd className="text-[10px] text-gray-400">F9</kbd>
              </button>
            )}

            <div className="border-t border-[#393b40]/60 my-1" />
          </>
        )}

        {/* Context Actions */}
        <button
          onClick={() => {
            onClose();
          }}
          className="w-full text-left px-3 py-1.5 hover:bg-[#3574f0] hover:text-white flex items-center justify-between"
        >
          <div className="flex items-center space-x-2">
            <Zap className="w-3.5 h-3.5 text-amber-400" />
            <span>Show Context Actions</span>
          </div>
          <kbd className="text-[10px] text-gray-400">⌥↵</kbd>
        </button>

        {/* Go to Implementation - Primary action */}
        <button
          onClick={() => {
            onClose();
            onGoToImplementation();
          }}
          className="w-full text-left px-3 py-1.5 hover:bg-[#3574f0] hover:text-white flex items-center justify-between font-semibold text-blue-300 bg-blue-500/10"
        >
          <div className="flex items-center space-x-2">
            <Layers className="w-3.5 h-3.5 text-blue-400" />
            <span>Go to Implementation</span>
          </div>
          <kbd className="text-[10px] text-blue-300 font-mono">⌥⌘B</kbd>
        </button>

        {/* Declaration or Usages */}
        <button
          onClick={() => {
            onClose();
            onGoToDefinition();
          }}
          className="w-full text-left px-3 py-1.5 hover:bg-[#3574f0] hover:text-white flex items-center justify-between"
        >
          <span>Declaration or Usages</span>
          <kbd className="text-[10px] text-gray-400">⌘B / F12</kbd>
        </button>

        {/* Find Usages */}
        <button
          onClick={() => {
            onClose();
            onFindUsages();
          }}
          className="w-full text-left px-3 py-1.5 hover:bg-[#3574f0] hover:text-white flex items-center justify-between"
        >
          <span>Find Usages</span>
          <kbd className="text-[10px] text-gray-400">⌥F7</kbd>
        </button>

        <div className="border-t border-[#393b40]/60 my-1" />

        {/* AppSettings Environment Variable item if in appsettings.json */}
        {isAppSettings && (
          <>
            <button
              onClick={() => {
                onClose();
                onOpenAppSettingsEnv?.();
              }}
              className="w-full text-left px-3 py-1.5 hover:bg-[#3574f0] hover:text-white flex items-center justify-between bg-amber-500/10 text-amber-300 font-semibold"
            >
              <div className="flex items-center space-x-2">
                <FolderSync className="w-3.5 h-3.5 text-amber-400" />
                <span>Set as Environment Variable...</span>
              </div>
              <span className="text-[10px] text-emerald-400 bg-emerald-500/20 px-1 rounded font-mono">auto env</span>
            </button>
            <div className="border-t border-[#393b40]/60 my-1" />
          </>
        )}

        {/* Go To > Menu Item with nested Submenu (Matching JetBrains Rider screenshot) */}
        <div
          className="relative"
          onMouseEnter={() => setIsGoToSubmenuOpen(true)}
          onMouseLeave={() => setIsGoToSubmenuOpen(false)}
        >
          <div
            className={`w-full text-left px-3 py-1.5 flex items-center justify-between cursor-pointer transition ${
              isGoToSubmenuOpen ? 'bg-[#3574f0] text-white font-medium' : 'hover:bg-[#3574f0] hover:text-white'
            }`}
          >
            <div className="flex items-center space-x-2">
              <ArrowUpRight className="w-3.5 h-3.5 text-blue-400" />
              <span>Go To</span>
            </div>
            <ChevronRight className="w-3.5 h-3.5" />
          </div>

          {/* Submenu */}
          {isGoToSubmenuOpen && (
            <div
              className="absolute left-full top-0 -ml-1 bg-[#26282b] border border-[#393b40] rounded-lg shadow-2xl py-1 text-xs text-[#dfe1e5] w-64 z-50 font-sans"
              onClick={(e) => e.stopPropagation()}
            >
              <button
                onClick={() => {
                  onClose();
                }}
                className="w-full text-left px-3 py-1.5 hover:bg-[#3574f0] hover:text-white flex items-center justify-between"
              >
                <span>Navigation Bar</span>
                <kbd className="text-[10px] text-gray-400">⌘↑</kbd>
              </button>

              <button
                onClick={() => {
                  onClose();
                  onGoToDefinition();
                }}
                className="w-full text-left px-3 py-1.5 hover:bg-[#3574f0] hover:text-white flex items-center justify-between"
              >
                <span>Declaration or Usages</span>
                <kbd className="text-[10px] text-gray-400">⌘B / F12</kbd>
              </button>

              <button
                onClick={() => {
                  onClose();
                  onGoToImplementation();
                }}
                className="w-full text-left px-3 py-1.5 hover:bg-[#3574f0] hover:text-white flex items-center justify-between"
              >
                <span>Derived Symbols</span>
                <kbd className="text-[10px] text-gray-400">⌥⌘B</kbd>
              </button>

              {/* GO TO IMPLEMENTATION */}
              <button
                onClick={() => {
                  onClose();
                  onGoToImplementation();
                }}
                className="w-full text-left px-3 py-1.5 hover:bg-[#3574f0] hover:text-white flex items-center justify-between bg-blue-500/10 text-blue-300 font-bold"
              >
                <div className="flex items-center space-x-1.5">
                  <div className="w-1.5 h-1.5 rounded-full bg-blue-400" />
                  <span>Go to Implementation</span>
                </div>
                <kbd className="text-[10px] text-blue-300 bg-blue-500/20 px-1 rounded font-mono">⌥⌘B</kbd>
              </button>

              <button
                onClick={() => {
                  onClose();
                  onGoToDefinition();
                }}
                className="w-full text-left px-3 py-1.5 hover:bg-[#3574f0] hover:text-white flex items-center justify-between"
              >
                <span>Type of Symbol</span>
                <kbd className="text-[10px] text-gray-400">⇧⌘B</kbd>
              </button>

              <button
                onClick={() => {
                  onClose();
                }}
                className="w-full text-left px-3 py-1.5 hover:bg-[#3574f0] hover:text-white flex items-center justify-between"
              >
                <span>Base Symbols</span>
                <kbd className="text-[10px] text-gray-400">⌘U</kbd>
              </button>

              <button
                onClick={() => {
                  onClose();
                }}
                className="w-full text-left px-3 py-1.5 hover:bg-[#3574f0] hover:text-white flex items-center justify-between"
              >
                <span>Related Files</span>
                <kbd className="text-[10px] text-gray-400">⌃⌘↑</kbd>
              </button>
            </div>
          )}
        </div>

        {/* Change All Occurrences */}
        <button
          onClick={() => {
            onClose();
            onChangeAllOccurrences?.();
          }}
          className="w-full text-left px-3 py-1.5 hover:bg-[#3574f0] hover:text-white flex items-center justify-between text-gray-300"
        >
          <div className="flex items-center space-x-2">
            <Replace className="w-3.5 h-3.5 text-gray-400" />
            <span>Change All Occurrences</span>
          </div>
          <kbd className="text-[10px] text-gray-400">⌘F2</kbd>
        </button>

        <div className="border-t border-[#393b40]/60 my-1" />

        {/* Standard Clipboard Actions */}
        <button
          onClick={() => {
            onClose();
            onCut?.();
          }}
          className="w-full text-left px-3 py-1.5 hover:bg-[#3574f0] hover:text-white flex items-center justify-between text-gray-300"
        >
          <div className="flex items-center space-x-2">
            <Scissors className="w-3.5 h-3.5 text-gray-400" />
            <span>Cut</span>
          </div>
          <kbd className="text-[10px] text-gray-400">⌘X</kbd>
        </button>

        <button
          onClick={() => {
            onClose();
            onCopy?.();
          }}
          className="w-full text-left px-3 py-1.5 hover:bg-[#3574f0] hover:text-white flex items-center justify-between text-gray-300"
        >
          <div className="flex items-center space-x-2">
            <Copy className="w-3.5 h-3.5 text-gray-400" />
            <span>Copy</span>
          </div>
          <kbd className="text-[10px] text-gray-400">⌘C</kbd>
        </button>

        <button
          onClick={() => {
            onClose();
            onPaste?.();
          }}
          className="w-full text-left px-3 py-1.5 hover:bg-[#3574f0] hover:text-white flex items-center justify-between text-gray-300"
        >
          <div className="flex items-center space-x-2">
            <Clipboard className="w-3.5 h-3.5 text-gray-400" />
            <span>Paste</span>
          </div>
          <kbd className="text-[10px] text-gray-400">⌘V</kbd>
        </button>

        <div className="border-t border-[#393b40]/60 my-1" />

        {/* Command Palette */}
        <button
          onClick={() => {
            onClose();
            onOpenCommandPalette?.();
          }}
          className="w-full text-left px-3 py-1.5 hover:bg-[#3574f0] hover:text-white flex items-center justify-between text-gray-300"
        >
          <div className="flex items-center space-x-2">
            <Terminal className="w-3.5 h-3.5 text-gray-400" />
            <span>Command Palette</span>
          </div>
          <kbd className="text-[10px] text-gray-400">F1</kbd>
        </button>
      </div>
    </div>
  );
};
