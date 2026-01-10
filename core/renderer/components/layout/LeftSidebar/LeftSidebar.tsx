import React from 'react';
import { Tooltip } from '@/components/ui';
import { 
  CollectionsIcon, EnvironmentsIcon, HistoryIcon, MockingIcon, 
  SocketIcon, GraphQLIcon, GitIcon, WorkspacesIcon 
} from '@/components/ui/icons';
import { useApp } from '@/contexts';
import { isWebStandalone } from '@/utils';
import './LeftSidebar.css';

type SidebarView = 'collections' | 'environments' | 'history' | 'mocking' | 'socket' | 'graphql' | 'git' | 'workspaces';

const menuItems: { id: SidebarView; icon: React.FC; label: string; electronOnly?: boolean; standaloneOnly?: boolean }[] = [
  { id: 'collections', icon: CollectionsIcon, label: 'Collections' },
  { id: 'environments', icon: EnvironmentsIcon, label: 'Global Environments', standaloneOnly: true },
  { id: 'workspaces', icon: WorkspacesIcon, label: 'Workspaces', electronOnly: true },
  { id: 'history', icon: HistoryIcon, label: 'History' },
  { id: 'mocking', icon: MockingIcon, label: 'Mocking', electronOnly: true },
  { id: 'git', icon: GitIcon, label: 'Git', electronOnly: true },
  { id: 'graphql', icon: GraphQLIcon, label: 'GraphQL' },
];

export const LeftSidebar: React.FC = () => {
  const { sidebarView, setSidebarView, sidebarState, isWebMode } = useApp();
  
  // Check if we're in standalone web mode (web.echolon.app) vs embedded
  const webStandalone = isWebStandalone();
  
  // Filter out items based on mode:
  // - electronOnly: hide in web mode
  // - standaloneOnly: hide in embedded web mode (show in Electron and standalone web)
  const visibleMenuItems = menuItems.filter(item => {
    if (isWebMode && item.electronOnly) return false;
    if (isWebMode && !webStandalone && item.standaloneOnly) return false;
    return true;
  });
  
  const isExpanded = sidebarState === 'expanded';

  return (
    <div className={`left-sidebar ${isExpanded ? 'left-sidebar--expanded' : ''}`}>
      <div className="left-sidebar__menu">
        {visibleMenuItems.map(item => (
          isExpanded ? (
            <button
              key={item.id}
              className={`left-sidebar__item ${sidebarView === item.id ? 'left-sidebar__item--active' : ''}`}
              onClick={() => setSidebarView(item.id)}
              aria-label={item.label}
            >
              <item.icon />
              <span className="left-sidebar__item-label">{item.label}</span>
            </button>
          ) : (
            <Tooltip key={item.id} content={item.label} position="right">
              <button
                className={`left-sidebar__item ${sidebarView === item.id ? 'left-sidebar__item--active' : ''}`}
                onClick={() => setSidebarView(item.id)}
                aria-label={item.label}
              >
                <item.icon />
              </button>
            </Tooltip>
          )
        ))}
      </div>
    </div>
  );
};

export default LeftSidebar;

