import React, { useMemo } from 'react';
import { useCollections, useWebModeOptional } from '@/contexts';
import { Request, Collection, Folder } from '@/types';
import { RequestCard } from './RequestCard';
import './APIReferencePanel.css';

interface GroupedRequest {
  request: Request;
  collection: Collection;
  folderPath: string[];
}

// Helper to flatten all requests from a collection (including nested folders)
function flattenRequests(
  collection: Collection,
  folder?: Folder,
  path: string[] = []
): GroupedRequest[] {
  const results: GroupedRequest[] = [];
  
  const targetRequests = folder ? folder.requests : collection.requests;
  const targetFolders = folder ? folder.folders : collection.folders;
  const currentPath = folder ? [...path, folder.name] : path;

  // Add requests from current level
  for (const request of targetRequests) {
    results.push({
      request,
      collection,
      folderPath: currentPath,
    });
  }

  // Recursively add requests from subfolders
  for (const subFolder of targetFolders) {
    results.push(...flattenRequests(collection, subFolder, currentPath));
  }

  return results;
}

export const APIReferencePanel: React.FC = () => {
  const { collections } = useCollections();
  const webMode = useWebModeOptional();

  // Flatten all requests from all collections
  const allRequests = useMemo(() => {
    const requests: GroupedRequest[] = [];
    
    // If we have a loaded collection from web mode, prioritize it
    const targetCollections = webMode?.loadedCollection 
      ? [webMode.loadedCollection]
      : collections;

    for (const collection of targetCollections) {
      requests.push(...flattenRequests(collection));
    }

    return requests;
  }, [collections, webMode?.loadedCollection]);

  // Group requests by collection and folder
  const groupedRequests = useMemo(() => {
    const groups: Map<string, GroupedRequest[]> = new Map();

    for (const item of allRequests) {
      const groupKey = item.folderPath.length > 0
        ? `${item.collection.name} / ${item.folderPath.join(' / ')}`
        : item.collection.name;

      if (!groups.has(groupKey)) {
        groups.set(groupKey, []);
      }
      groups.get(groupKey)!.push(item);
    }

    return groups;
  }, [allRequests]);

  if (allRequests.length === 0) {
    return (
      <div className="api-reference-panel api-reference-panel--empty">
        <div className="api-reference-panel__empty-state">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
            <path d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" />
          </svg>
          <h3>No API Endpoints</h3>
          <p>Import an OpenAPI spec or create a collection to see endpoints here.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="api-reference-panel">
      <div className="api-reference-panel__header">
        <h2>API Reference</h2>
        <span className="api-reference-panel__count">
          {allRequests.length} endpoint{allRequests.length !== 1 ? 's' : ''}
        </span>
      </div>

      <div className="api-reference-panel__content">
        {Array.from(groupedRequests.entries()).map(([groupName, requests]) => (
          <div key={groupName} className="api-reference-panel__group">
            <div className="api-reference-panel__group-header">
              <span className="api-reference-panel__group-name">{groupName}</span>
              <span className="api-reference-panel__group-count">
                {requests.length}
              </span>
            </div>
            
            <div className="api-reference-panel__group-requests">
              {requests.map((item) => (
                <RequestCard
                  key={item.request.id}
                  request={item.request}
                  collection={item.collection}
                />
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};

export default APIReferencePanel;

