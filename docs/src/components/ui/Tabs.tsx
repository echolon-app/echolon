import { useState, type ReactNode } from 'react';

interface Tab {
  id: string;
  label: string;
  content: ReactNode;
}

interface TabsProps {
  tabs: Tab[];
  defaultTab?: string;
}

export function Tabs({ tabs, defaultTab }: TabsProps) {
  const [activeTab, setActiveTab] = useState(defaultTab || tabs[0]?.id);
  
  const activeContent = tabs.find(tab => tab.id === activeTab)?.content;
  
  return (
    <div className="tabs">
      <div className="tabs__list" role="tablist">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            role="tab"
            aria-selected={activeTab === tab.id}
            className={`tabs__tab ${activeTab === tab.id ? 'is-active' : ''}`}
            onClick={() => setActiveTab(tab.id)}
          >
            {tab.label}
          </button>
        ))}
      </div>
      <div className="tabs__content" role="tabpanel">
        {activeContent}
      </div>
      <style>{`
        .tabs {
          margin: var(--spacing-4) 0;
          border: 1px solid var(--color-border);
          border-radius: var(--radius-lg);
          overflow: hidden;
        }
        
        .tabs__list {
          display: flex;
          background: var(--color-bg-tertiary);
          border-bottom: 1px solid var(--color-border);
        }
        
        .tabs__tab {
          padding: var(--spacing-3) var(--spacing-4);
          font-size: var(--font-size-sm);
          font-weight: 500;
          color: var(--color-text-secondary);
          background: transparent;
          border: none;
          cursor: pointer;
          transition: all var(--transition-fast);
          position: relative;
        }
        
        .tabs__tab:hover {
          color: var(--color-text);
        }
        
        .tabs__tab.is-active {
          color: var(--color-primary);
          background: var(--color-bg);
        }
        
        .tabs__tab.is-active::after {
          content: '';
          position: absolute;
          bottom: -1px;
          left: 0;
          right: 0;
          height: 2px;
          background: var(--color-primary);
        }
        
        .tabs__content {
          padding: var(--spacing-4);
          background: var(--color-bg);
        }
      `}</style>
    </div>
  );
}

export default Tabs;

