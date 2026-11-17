import React, { useState, useEffect, useRef } from 'react';
import { Search, FileCode, FileJson, FileText, Layers, X } from 'lucide-react';
import { SolutionFileItem, SolutionFile } from '../types/minirider';

interface QuickOpenModalProps {
  isOpen: boolean;
  onClose: () => void;
  solution: SolutionFile;
  onSelectFile: (file: SolutionFileItem) => void;
}

export const QuickOpenModal: React.FC<QuickOpenModalProps> = ({
  isOpen,
  onClose,
  solution,
  onSelectFile
}) => {
  const [query, setQuery] = useState('');
  const [selectedIndex, setSelectedIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  // Flatten all files in solution
  const allFiles: SolutionFileItem[] = [];
  solution.projects.forEach(p => {
    const walk = (items: SolutionFileItem[]) => {
      items.forEach(i => {
        if (!i.isDirectory) allFiles.push(i);
        if (i.children) walk(i.children);
      });
    };
    walk(p.files);
  });

  const filtered = allFiles.filter(f =>
    f.name.toLowerCase().includes(query.toLowerCase()) ||
    f.relativePath.toLowerCase().includes(query.toLowerCase())
  );

  useEffect(() => {
    if (isOpen) {
      setQuery('');
      setSelectedIndex(0);
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [isOpen]);

  if (!isOpen) return null;

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      onClose();
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      setSelectedIndex(i => Math.min(filtered.length - 1, i + 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setSelectedIndex(i => Math.max(0, i - 1));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (filtered[selectedIndex]) {
        onSelectFile(filtered[selectedIndex]);
        onClose();
      }
    }
  };

  const getIcon = (ext: string) => {
    if (ext === '.cs') return <FileCode className="w-4 h-4 text-emerald-400" />;
    if (ext === '.json') return <FileJson className="w-4 h-4 text-amber-400" />;
    if (ext === '.csproj' || ext === '.sln' || ext === '.slnx') return <Layers className="w-4 h-4 text-indigo-400" />;
    return <FileText className="w-4 h-4 text-slate-400" />;
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex items-start justify-center pt-20 p-4">
      <div className="bg-[#1e1f22] border border-[#393b40] rounded-xl w-full max-w-xl shadow-2xl overflow-hidden font-sans text-xs">
        {/* Search Input Bar */}
        <div className="p-3 bg-[#26282b] border-b border-[#2b2d30] flex items-center space-x-2">
          <Search className="w-4 h-4 text-gray-400 shrink-0" />
          <input
            ref={inputRef}
            type="text"
            placeholder="Type a file name to open in Cairn IDE (e.g. UsersController.cs, Program.cs)..."
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setSelectedIndex(0);
            }}
            onKeyDown={handleKeyDown}
            className="flex-1 bg-transparent text-white focus:outline-none text-sm placeholder:text-gray-500"
          />
          <kbd className="bg-[#1e1f22] px-1.5 py-0.5 rounded text-[10px] text-gray-400 border border-[#393b40]">ESC</kbd>
        </div>

        {/* Results List */}
        <div className="max-h-80 overflow-y-auto p-1 space-y-0.5">
          {filtered.length === 0 ? (
            <div className="p-4 text-center text-gray-500 italic">No files match &apos;{query}&apos;</div>
          ) : (
            filtered.map((file, idx) => {
              const isSelected = selectedIndex === idx;
              return (
                <div
                  key={file.id}
                  onClick={() => {
                    onSelectFile(file);
                    onClose();
                  }}
                  className={`flex items-center justify-between p-2 rounded cursor-pointer transition ${
                    isSelected ? 'bg-[#3574f0] text-white' : 'hover:bg-[#2b2d30] text-[#dfe1e5]'
                  }`}
                >
                  <div className="flex items-center space-x-2 truncate">
                    {getIcon(file.extension)}
                    <span className="font-medium text-xs truncate">{file.name}</span>
                  </div>
                  <span className={`text-[11px] truncate max-w-xs ${isSelected ? 'text-blue-100' : 'text-gray-500'}`}>
                    {file.relativePath}
                  </span>
                </div>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
};
