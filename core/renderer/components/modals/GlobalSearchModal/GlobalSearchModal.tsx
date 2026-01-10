import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { Input } from '@/components/ui';
import { SearchIcon, FolderIcon, HistoryIcon } from '@/components/ui/icons';
import { useApp, useCollections, useRequest, useWorkspace } from '@/contexts';
import { Request, Collection, Folder, HistoryEntry } from '@/types';
import { METHOD_COLORS } from '../../../../shared/constants';
import './GlobalSearchModal.css';

const getMethodColor = (method: string): string => {
  return METHOD_COLORS[method] || '#9ca3af';
};

interface SearchResult {
  type: 'collection' | 'request' | 'folder' | 'history';
  item: Collection | Request | Folder | HistoryEntry;
  collectionId?: string;
  collectionName?: string;
  folderName?: string;
}

// Helper to find collection info for a request (including nested folders)
const findCollectionForRequest = (collections: Collection[], requestId: string): { collectionId?: string; collectionName?: string; folderName?: string } => {
  for (const collection of collections) {
    // Check direct requests
    if (collection.requests.some(r => r.id === requestId)) {
      return { collectionId: collection.id, collectionName: collection.name };
    }
    
    // Check folders recursively
    const checkFolders = (folders: Folder[], path: string[] = []): { collectionId?: string; collectionName?: string; folderName?: string } | null => {
      for (const folder of folders) {
        if (folder.requests.some(r => r.id === requestId)) {
          return { 
            collectionId: collection.id,
            collectionName: collection.name, 
            folderName: [...path, folder.name].join(' / ')
          };
        }
        const result = checkFolders(folder.folders, [...path, folder.name]);
        if (result) return result;
      }
      return null;
    };
    
    const folderResult = checkFolders(collection.folders);
    if (folderResult) return folderResult;
  }
  return {};
};

export const GlobalSearchModal: React.FC = () => {
  const { globalSearchOpen, closeGlobalSearch } = useApp();
  const { collections, searchCollections } = useCollections();
  const { addTab, history } = useRequest();
  const { activeWorkspaceId } = useWorkspace();
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SearchResult[]>([]);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (globalSearchOpen) {
      setQuery('');
      setResults([]);
      setSelectedIndex(0);
      setTimeout(() => inputRef.current?.focus(), 100);
    }
  }, [globalSearchOpen]);

  useEffect(() => {
    if (!query.trim()) {
      setResults([]);
      return;
    }

    const { collections: matchedCollections, requests: matchedRequests, folders: matchedFolders } = searchCollections(query);
    const lowerQuery = query.toLowerCase();
    
    // Search history (filtered by active workspace)
    const workspaceHistory = activeWorkspaceId
      ? history.filter(h => h.request.workspaceId === activeWorkspaceId)
      : history;
    const matchedHistory = workspaceHistory.filter(h => 
      h.request.name.toLowerCase().includes(lowerQuery) ||
      h.request.url.toLowerCase().includes(lowerQuery) ||
      h.request.method.toLowerCase().includes(lowerQuery) ||
      (h.request.tags?.some(tag => tag.toLowerCase().includes(lowerQuery)) ?? false)
    ).slice(0, 5);
    
    const newResults: SearchResult[] = [
      // Requests first (most commonly searched)
      ...matchedRequests.map(r => {
        const { collectionId, collectionName, folderName } = findCollectionForRequest(collections, r.id);
        return { 
          type: 'request' as const, 
          item: r,
          collectionId,
          collectionName,
          folderName
        };
      }),
      // Collections
      ...matchedCollections.map(c => ({ type: 'collection' as const, item: c })),
      // Folders
      ...matchedFolders.map(f => ({ type: 'folder' as const, item: f })),
      // History (at the end)
      ...matchedHistory.map(h => ({
        type: 'history' as const,
        item: h,
      })),
    ];

    setResults(newResults.slice(0, 15));
    setSelectedIndex(0);
  }, [query, searchCollections, collections, history, activeWorkspaceId]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setSelectedIndex(prev => Math.min(prev + 1, results.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setSelectedIndex(prev => Math.max(prev - 1, 0));
    } else if (e.key === 'Enter' && results[selectedIndex]) {
      e.preventDefault();
      handleSelect(results[selectedIndex]);
    } else if (e.key === 'Escape') {
      closeGlobalSearch();
    }
  }, [results, selectedIndex, closeGlobalSearch]);

  const handleSelect = (result: SearchResult) => {
    if (result.type === 'request') {
      const request = result.item as Request;
      // Ensure collectionId is set on the request for proper variable resolution
      const requestWithCollection = result.collectionId && !request.collectionId
        ? { ...request, collectionId: result.collectionId }
        : request;
      addTab(requestWithCollection);
    } else if (result.type === 'history') {
      const historyEntry = result.item as HistoryEntry;
      addTab(historyEntry.request);
    }
    // For collections and folders, we just close (could expand later to show contents)
    closeGlobalSearch();
  };

  if (!globalSearchOpen) return null;

  return createPortal(
    <div className="global-search-overlay" onClick={closeGlobalSearch}>
      <div className="global-search" onClick={(e) => e.stopPropagation()}>
        <div className="global-search__input-wrapper">
          <SearchIcon />
          <input
            ref={inputRef}
            className="global-search__input"
            placeholder="Search collections, requests, tags..."
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={handleKeyDown}
          />
          <kbd>ESC</kbd>
        </div>

        {results.length > 0 && (
          <div className="global-search__results">
            {results.map((result, index) => {
              const getKey = () => {
                switch (result.type) {
                  case 'collection': return `col-${(result.item as Collection).id}`;
                  case 'request': return `req-${(result.item as Request).id}`;
                  case 'folder': return `fld-${(result.item as Folder).id}`;
                  case 'history': return `hist-${(result.item as HistoryEntry).id}`;
                }
              };
              
              return (
                <div
                  key={getKey()}
                  className={`global-search__result ${index === selectedIndex ? 'selected' : ''}`}
                  onClick={() => handleSelect(result)}
                  onMouseEnter={() => setSelectedIndex(index)}
                >
                  {result.type === 'collection' && (
                    <>
                      <span className="global-search__result-icon">📁</span>
                      <span className="global-search__result-name">{(result.item as Collection).name}</span>
                      <span className="global-search__result-type">Collection</span>
                    </>
                  )}
                  
                  {result.type === 'folder' && (
                    <>
                      <span className="global-search__result-icon"><FolderIcon /></span>
                      <span className="global-search__result-name">{(result.item as Folder).name}</span>
                      <span className="global-search__result-type">Folder</span>
                    </>
                  )}
                  
                  {result.type === 'request' && (
                    <>
                      <span 
                        className="global-search__result-method"
                        style={{ color: getMethodColor((result.item as Request).method) }}
                      >
                        {(result.item as Request).method}
                      </span>
                      <span className="global-search__result-name">{(result.item as Request).name}</span>
                      <span className="global-search__result-path">
                        {result.collectionName}
                        {result.folderName && ` / ${result.folderName}`}
                      </span>
                    </>
                  )}
                  
                  {result.type === 'history' && (
                    <>
                      <span className="global-search__result-icon global-search__result-icon--history">
                        <HistoryIcon />
                      </span>
                      <span 
                        className="global-search__result-method"
                        style={{ color: getMethodColor((result.item as HistoryEntry).request.method) }}
                      >
                        {(result.item as HistoryEntry).request.method}
                      </span>
                      <span className="global-search__result-name">{(result.item as HistoryEntry).request.name}</span>
                      <span className="global-search__result-type">History</span>
                    </>
                  )}
                </div>
              );
            })}
          </div>
        )}

        {query && results.length === 0 && (
          <div className="global-search__empty">
            No results found for "{query}"
          </div>
        )}

        {!query && (
          <div className="global-search__hint">
            <p>Start typing to search...</p>
            <div className="global-search__shortcuts">
              <span><kbd>↑</kbd><kbd>↓</kbd> to navigate</span>
              <span><kbd>↵</kbd> to select</span>
              <span><kbd>ESC</kbd> to close</span>
            </div>
          </div>
        )}
      </div>
    </div>,
    document.body
  );
};

export default GlobalSearchModal;

