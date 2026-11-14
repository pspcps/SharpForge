import React from 'react';
import { Apple, ExternalLink, CheckCircle2, X } from 'lucide-react';

interface FinderNotificationProps {
  path: string | null;
  onClose: () => void;
}

export const FinderNotification: React.FC<FinderNotificationProps> = ({ path, onClose }) => {
  if (!path) return null;

  return (
    <div className="fixed bottom-10 right-6 z-50 bg-[#26282b] border border-[#393b40] rounded-xl p-3 shadow-2xl flex items-center space-x-3 text-xs text-white max-w-md animate-in slide-in-from-bottom duration-200">
      <div className="w-8 h-8 rounded-lg bg-blue-600/20 text-blue-400 flex items-center justify-center shrink-0 border border-blue-500/30">
        <Apple className="w-4 h-4 fill-current" />
      </div>

      <div className="flex-1 truncate space-y-0.5">
        <div className="font-semibold text-slate-100 flex items-center space-x-1.5">
          <span>Revealed in macOS Finder</span>
          <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
        </div>
        <div className="font-mono text-[11px] text-gray-400 truncate" title={path}>
          {path}
        </div>
      </div>

      <button
        onClick={onClose}
        className="p-1 text-gray-400 hover:text-white hover:bg-[#35373c] rounded transition shrink-0"
      >
        <X className="w-4 h-4" />
      </button>
    </div>
  );
};
