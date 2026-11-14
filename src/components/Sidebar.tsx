import React from 'react';
import { 
  FolderTree, 
  FlaskConical, 
  Box, 
  FolderGit2, 
  Search, 
  HelpCircle,
  Blocks
} from 'lucide-react';

export type ActiveSidebarTab = 'explorer' | 'tests' | 'nuget' | 'git' | 'search' | 'extensions';

interface SidebarProps {
  activeTab: ActiveSidebarTab;
  onSelectTab: (tab: ActiveSidebarTab) => void;
  testCount?: number;
  gitChangesCount?: number;
  extensionsCount?: number;
  onOpenShortcutsModal: () => void;
}

export const Sidebar: React.FC<SidebarProps> = ({
  activeTab,
  onSelectTab,
  testCount = 5,
  gitChangesCount = 1,
  extensionsCount = 0,
  onOpenShortcutsModal
}) => {
  const navItems = [
    { id: 'explorer' as ActiveSidebarTab, label: 'Solution Explorer', icon: FolderTree },
    { id: 'tests' as ActiveSidebarTab, label: 'Unit Tests', icon: FlaskConical, badge: testCount },
    { id: 'nuget' as ActiveSidebarTab, label: 'NuGet Packages', icon: Box },
    { id: 'git' as ActiveSidebarTab, label: 'Git Source Control', icon: FolderGit2, badge: gitChangesCount },
    { id: 'search' as ActiveSidebarTab, label: 'Find in Solution', icon: Search },
    { id: 'extensions' as ActiveSidebarTab, label: 'Extensions & Plugins (VS Code / JetBrains)', icon: Blocks, badge: extensionsCount }
  ];

  return (
    <aside className="w-12 bg-[#1e1f22] border-r border-[#2b2d30] flex flex-col justify-between py-2 select-none z-10">
      <div className="flex flex-col items-center space-y-1">
        {navItems.map(item => {
          const Icon = item.icon;
          const isActive = activeTab === item.id;
          return (
            <button
              key={item.id}
              onClick={() => onSelectTab(item.id)}
              className={`relative w-9 h-9 flex items-center justify-center rounded-md transition group ${
                isActive
                  ? 'bg-[#3574f0] text-white shadow-sm'
                  : 'text-[#868a91] hover:text-[#dfe1e5] hover:bg-[#2b2d30]'
              }`}
              title={item.label}
            >
              <Icon className="w-4 h-4" />
              {item.badge !== undefined && item.badge > 0 && (
                <span className={`absolute -top-1 -right-1 text-[9px] px-1 rounded-full font-bold ${
                  isActive ? 'bg-white text-[#3574f0]' : 'bg-[#3574f0] text-white'
                }`}>
                  {item.badge}
                </span>
              )}
            </button>
          );
        })}
      </div>

      <div className="flex flex-col items-center space-y-1">
        <button
          onClick={onOpenShortcutsModal}
          className="w-9 h-9 flex items-center justify-center rounded-md text-[#868a91] hover:text-[#dfe1e5] hover:bg-[#2b2d30] transition"
          title="Keyboard Shortcuts & Help"
        >
          <HelpCircle className="w-4 h-4" />
        </button>
      </div>
    </aside>
  );
};
