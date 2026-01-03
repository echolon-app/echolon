import React from 'react';
import { Tooltip } from '@/components/ui';
import { 
  CollectionsIcon, EnvironmentsIcon, HistoryIcon, MockingIcon, 
  SocketIcon, GraphQLIcon, GitIcon 
} from '@/components/ui/icons';
import { useApp } from '@/contexts';
import './LeftSidebar.css';

type SidebarView = 'collections' | 'environments' | 'history' | 'mocking' | 'socket' | 'graphql' | 'git';

const menuItems: { id: SidebarView; icon: React.FC; label: string; electronOnly?: boolean }[] = [
  { id: 'collections', icon: CollectionsIcon, label: 'Collections' },
  { id: 'environments', icon: EnvironmentsIcon, label: 'Environments' },
  { id: 'history', icon: HistoryIcon, label: 'History' },
  { id: 'mocking', icon: MockingIcon, label: 'Mocking', electronOnly: true },
  { id: 'git', icon: GitIcon, label: 'Git', electronOnly: true },
  { id: 'graphql', icon: GraphQLIcon, label: 'GraphQL' },
];

export const LeftSidebar: React.FC = () => {
  const { sidebarView, setSidebarView, sidebarState, isWebMode } = useApp();
  
  // Filter out electron-only items when in web mode
  const visibleMenuItems = menuItems.filter(item => !isWebMode || !item.electronOnly);
  
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

