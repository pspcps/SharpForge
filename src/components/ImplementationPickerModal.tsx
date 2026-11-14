import React, { useState, useEffect } from 'react';
import { Layers, ArrowRight, X, FileCode, Check } from 'lucide-react';
import { ImplementationItem } from '../types/minirider';

interface ImplementationPickerModalProps {
  isOpen: boolean;
  onClose: () => void;
  symbolName: string;
  implementations: ImplementationItem[];
  onSelectImplementation: (item: ImplementationItem) => void;
}

export const ImplementationPickerModal: React.FC<ImplementationPickerModalProps> = ({
  isOpen,
  onClose,
  symbolName,
  implementations,
  onSelectImplementation
}) => {
  const [selectedIndex, setSelectedIndex] = useState(0);

  useEffect(() => {
    setSelectedIndex(0);
  }, [isOpen]);

  if (!isOpen || implementations.length === 0) return null;

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      onClose();
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      setSelectedIndex(i => Math.min(implementations.length - 1, i + 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setSelectedIndex(i => Math.max(0, i - 1));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (implementations[selectedIndex]) {
        onSelectImplementation(implementations[selectedIndex]);
        onClose();
      }
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 bg-black/40 backdrop-blur-xs flex items-start justify-center pt-24 p-4"
      onClick={onClose}
      onKeyDown={handleKeyDown}
      tabIndex={0}
    >
      <div
        className="bg-[#1e1f22] border border-[#393b40] rounded-xl w-full max-w-lg shadow-2xl overflow-hidden font-sans text-xs text-[#dfe1e5]"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="h-9 bg-[#26282b] border-b border-[#2b2d30] px-3 flex items-center justify-between">
          <div className="flex items-center space-x-2 font-semibold">
            <Layers className="w-3.5 h-3.5 text-blue-400" />
            <span>Implementations of &apos;{symbolName}&apos; ({implementations.length})</span>
          </div>
          <button onClick={onClose} className="p-0.5 hover:bg-[#35373c] text-gray-400 hover:text-white rounded">
            <X className="w-3.5 h-3.5" />
          </button>
        </div>

        {/* List of implementations */}
        <div className="max-h-64 overflow-y-auto p-1 space-y-0.5">
          {implementations.map((item, idx) => {
            const isSelected = selectedIndex === idx;
            return (
              <div
                key={idx}
                onClick={() => {
                  onSelectImplementation(item);
                  onClose();
                }}
                className={`p-2 rounded cursor-pointer transition flex items-center justify-between ${
                  isSelected ? 'bg-[#3574f0] text-white' : 'hover:bg-[#2b2d30] text-[#dfe1e5]'
                }`}
              >
                <div className="flex items-center space-x-2 truncate">
                  <FileCode className="w-4 h-4 text-emerald-400 shrink-0" />
                  <div className="truncate">
                    <div className="font-semibold text-xs flex items-center space-x-2">
                      <span>{item.name}</span>
                      {item.containerName && (
                        <span className={`text-[10px] ${isSelected ? 'text-blue-100' : 'text-gray-400'}`}>
                          ({item.containerName})
                        </span>
                      )}
                    </div>
                    <div className={`font-mono text-[11px] truncate ${isSelected ? 'text-blue-100' : 'text-gray-400'}`}>
                      {item.preview}
                    </div>
                  </div>
                </div>

                <div className="text-right shrink-0 ml-2">
                  <span className={`text-[10px] font-mono ${isSelected ? 'text-blue-100' : 'text-gray-500'}`}>
                    {item.file.split('/').pop()}:{item.line}
                  </span>
                </div>
              </div>
            );
          })}
        </div>

        <div className="h-7 bg-[#26282b] border-t border-[#2b2d30] px-3 flex items-center justify-between text-[10px] text-gray-400">
          <span>Press Enter or Click to Navigate to Implementation</span>
          <kbd className="bg-[#1e1f22] px-1 rounded border border-[#393b40]">ESC</kbd>
        </div>
      </div>
    </div>
  );
};
