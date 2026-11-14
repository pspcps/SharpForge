import React, { useState, useEffect, useRef } from 'react';
import { X, FileCode, Layers, Globe, FlaskConical, FileJson } from 'lucide-react';
import { ProjectItem } from '../types/minirider';

export type CSharpTemplateKind = 'class' | 'interface' | 'record' | 'controller' | 'test' | 'json';

interface NewFileModalProps {
  isOpen: boolean;
  onClose: () => void;
  project: ProjectItem | null;
  folderRelativePath?: string;
  onCreateFile: (fileName: string, template: CSharpTemplateKind) => void;
}

export const NewFileModal: React.FC<NewFileModalProps> = ({
  isOpen,
  onClose,
  project,
  folderRelativePath,
  onCreateFile
}) => {
  const [name, setName] = useState('');
  const [template, setTemplate] = useState<CSharpTemplateKind>('class');
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (isOpen) {
      setName('');
      setTemplate('class');
      setTimeout(() => inputRef.current?.focus(), 40);
    }
  }, [isOpen]);

  if (!isOpen || !project) return null;

  const templates: { id: CSharpTemplateKind; label: string; ext: string; icon: React.ReactNode }[] = [
    { id: 'class', label: 'Class', ext: '.cs', icon: <FileCode className="w-3.5 h-3.5 text-emerald-400" /> },
    { id: 'interface', label: 'Interface', ext: '.cs', icon: <Layers className="w-3.5 h-3.5 text-sky-400" /> },
    { id: 'record', label: 'Record', ext: '.cs', icon: <FileCode className="w-3.5 h-3.5 text-purple-400" /> },
    { id: 'controller', label: 'API Controller', ext: '.cs', icon: <Globe className="w-3.5 h-3.5 text-blue-400" /> },
    { id: 'test', label: 'xUnit Test Class', ext: '.cs', icon: <FlaskConical className="w-3.5 h-3.5 text-green-400" /> },
    { id: 'json', label: 'JSON Config', ext: '.json', icon: <FileJson className="w-3.5 h-3.5 text-amber-400" /> }
  ];

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = name.trim();
    if (!trimmed) return;
    onCreateFile(trimmed, template);
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex items-center justify-center p-4" onClick={onClose}>
      <div
        className="bg-[#1e1f22] border border-[#393b40] rounded-xl w-full max-w-md shadow-2xl overflow-hidden font-sans text-xs text-[#dfe1e5]"
        onClick={e => e.stopPropagation()}
      >
        <div className="h-10 bg-[#26282b] border-b border-[#2b2d30] px-4 flex items-center justify-between">
          <span className="font-bold text-sm">
            New File in {project.name}{folderRelativePath ? `/${folderRelativePath}` : ''}
          </span>
          <button onClick={onClose} className="p-1 hover:bg-[#35373c] text-gray-400 hover:text-white rounded">
            <X className="w-4 h-4" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-4 space-y-4">
          <div className="space-y-1.5">
            <label className="font-semibold text-slate-300">Item Name</label>
            <input
              ref={inputRef}
              type="text"
              value={name}
              onChange={e => setName(e.target.value)}
              placeholder={template === 'interface' ? 'IOrderRepository' : template === 'json' ? 'appsettings.Staging' : 'OrderService'}
              className="w-full bg-[#18191c] border border-[#393b40] rounded px-3 py-1.5 text-white font-mono text-xs focus:outline-none focus:border-[#3574f0]"
            />
          </div>

          <div className="space-y-1.5">
            <label className="font-semibold text-slate-300">C# / Project Template</label>
            <div className="grid grid-cols-2 gap-1.5">
              {templates.map(t => (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => setTemplate(t.id)}
                  className={`flex items-center space-x-2 px-2.5 py-2 rounded border text-left transition ${
                    template === t.id
                      ? 'bg-[#3574f0]/20 border-[#3574f0] text-white font-medium'
                      : 'bg-[#26282b] border-[#2b2d30] text-[#bcbec4] hover:border-[#4e5157]'
                  }`}
                >
                  {t.icon}
                  <span className="truncate">{t.label}</span>
                  <span className="ml-auto text-[10px] text-gray-500 font-mono">{t.ext}</span>
                </button>
              ))}
            </div>
          </div>

          <div className="flex items-center justify-end space-x-2 pt-2 border-t border-[#2b2d30]">
            <button type="button" onClick={onClose} className="px-3 py-1.5 hover:bg-[#35373c] text-gray-300 rounded">
              Cancel
            </button>
            <button
              type="submit"
              disabled={!name.trim()}
              className="px-3.5 py-1.5 bg-[#3574f0] hover:bg-blue-500 disabled:opacity-40 text-white rounded font-medium shadow"
            >
              Create File
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
