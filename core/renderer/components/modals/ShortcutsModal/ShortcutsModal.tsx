import React, { useState, useEffect } from 'react';
import { Input } from '@/components/ui';
import { CloseIcon } from '@/components/ui/icons';
import { useApp } from '@/contexts';
import './ShortcutsModal.css';

interface ShortcutItem {
  label: string;
  keys: string[];
}

interface ShortcutSection {
  title: string;
  items: ShortcutItem[];
}

const isMac = typeof navigator !== 'undefined' && navigator.platform.toUpperCase().indexOf('MAC') >= 0;
const cmdKey = isMac ? '⌘' : 'Ctrl';
const optKey = isMac ? '⌥' : 'Alt';

const shortcutSections: ShortcutSection[] = [
  {
    title: 'General',
    items: [
      { label: 'Search & command menu', keys: [cmdKey, 'K'] },
      { label: 'Keyboard shortcuts', keys: [cmdKey, 'O'] },
      { label: 'New Tab', keys: [cmdKey, 'E'] },
      { label: 'Close Tab', keys: [cmdKey, 'D'] },
      { label: 'Toggle sidebar', keys: [cmdKey, 'B'] },
      { label: 'Close current menu', keys: ['ESC'] },
    ],
  },
  {
    title: 'Request',
    items: [
      { label: 'Send Request', keys: [cmdKey, '↵'] },
      { label: 'Save Request', keys: [cmdKey, 'Z'] },
    ],
  },
  {
    title: 'Response',
    items: [
      { label: 'Download response as file', keys: [cmdKey, 'J'] },
      { label: 'Copy response to clipboard', keys: [cmdKey, '.'] },
    ],
  },
];

// CloseIcon is imported from @/components/ui/icons

export const ShortcutsModal: React.FC = () => {
  const { shortcutsModalOpen, closeShortcutsModal } = useApp();
  const [searchQuery, setSearchQuery] = useState('');
  const [isVisible, setIsVisible] = useState(false);
  const [expandedSections, setExpandedSections] = useState<Set<string>>(
    () => new Set(shortcutSections.map((s) => s.title))
  );

  const toggleSection = (title: string) => {
    setExpandedSections((prev) => {
      const next = new Set(prev);
      if (next.has(title)) {
        next.delete(title);
      } else {
        next.add(title);
      }
      return next;
    });
  };

  // Handle animation states
  useEffect(() => {
    if (shortcutsModalOpen) {
      // Small delay to trigger CSS transition
      requestAnimationFrame(() => {
        setIsVisible(true);
      });
    } else {
      setIsVisible(false);
    }
  }, [shortcutsModalOpen]);

  // Handle escape key
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && shortcutsModalOpen) {
        closeShortcutsModal();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [shortcutsModalOpen, closeShortcutsModal]);

  const filteredSections = shortcutSections
    .map((section) => ({
      ...section,
      items: section.items.filter((item) =>
        item.label.toLowerCase().includes(searchQuery.toLowerCase())
      ),
    }))
    .filter((section) => section.items.length > 0);

  if (!shortcutsModalOpen && !isVisible) return null;

  return (
    <>
      <div 
        className={`shortcuts-overlay ${isVisible ? 'shortcuts-overlay--visible' : ''}`}
        onClick={closeShortcutsModal}
      />
      <div className={`shortcuts-panel ${isVisible ? 'shortcuts-panel--visible' : ''}`}>
        <div className="shortcuts-panel__header">
          <h2>Shortcuts</h2>
          <button className="shortcuts-panel__close" onClick={closeShortcutsModal}>
            <CloseIcon />
          </button>
        </div>

        <div className="shortcuts-panel__search">
          <Input
            placeholder="Search"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            autoFocus
          />
        </div>

        <div className="shortcuts-panel__content">
          {filteredSections.map((section) => {
            const isExpanded = expandedSections.has(section.title);
            return (
              <div key={section.title} className="shortcuts-panel__section">
                <button
                  className={`shortcuts-panel__section-header ${!isExpanded ? 'shortcuts-panel__section-header--collapsed' : ''}`}
                  onClick={() => toggleSection(section.title)}
                >
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="m6 9 6 6 6-6"/>
                  </svg>
                  <span>{section.title}</span>
                </button>
                <div className={`shortcuts-panel__items ${!isExpanded ? 'shortcuts-panel__items--collapsed' : ''}`}>
                  {section.items.map((item) => (
                    <div key={item.label} className="shortcuts-panel__item">
                      <span className="shortcuts-panel__item-label">{item.label}</span>
                      <div className="shortcuts-panel__item-keys">
                        {item.keys.map((key, idx) => (
                          <kbd key={idx}>{key}</kbd>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </>
  );
};

export default ShortcutsModal;
