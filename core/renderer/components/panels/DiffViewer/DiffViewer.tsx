import React, { useMemo, useEffect, useRef } from 'react';
import { CodeEditor } from '@/components/ui/CodeEditor/CodeEditor';
import { FileIcon, PlusIcon, XIcon } from '@/components/ui/icons';
import './DiffViewer.css';

interface DiffViewerProps {
  filePath: string;
  oldContent: string;
  newContent: string;
  status: 'added' | 'modified' | 'deleted';
}

// Simple diff algorithm to find changed lines
function computeDiff(oldLines: string[], newLines: string[]): { 
  deletedLines: number[]; 
  addedLines: number[];
  modifiedOldLines: number[];
  modifiedNewLines: number[];
} {
  const deletedLines: number[] = [];
  const addedLines: number[] = [];
  const modifiedOldLines: number[] = [];
  const modifiedNewLines: number[] = [];
  
  // Use LCS-based approach for better accuracy
  const oldSet = new Set(oldLines);
  const newSet = new Set(newLines);
  
  // Find lines that exist in old but not in new (deleted or modified)
  oldLines.forEach((line, idx) => {
    if (!newSet.has(line)) {
      // Check if there's a corresponding line at same position that's different
      if (idx < newLines.length && newLines[idx] !== line) {
        modifiedOldLines.push(idx);
      } else {
        deletedLines.push(idx);
      }
    }
  });
  
  // Find lines that exist in new but not in old (added or modified)
  newLines.forEach((line, idx) => {
    if (!oldSet.has(line)) {
      // Check if there's a corresponding line at same position that's different
      if (idx < oldLines.length && oldLines[idx] !== line) {
        modifiedNewLines.push(idx);
      } else {
        addedLines.push(idx);
      }
    }
  });
  
  return { deletedLines, addedLines, modifiedOldLines, modifiedNewLines };
}

export const DiffViewer: React.FC<DiffViewerProps> = ({
  filePath,
  oldContent,
  newContent,
  status,
}) => {
  const fileName = useMemo(() => filePath.split('/').pop() || filePath, [filePath]);
  const oldEditorRef = useRef<any>(null);
  const newEditorRef = useRef<any>(null);

  // Compute diff information
  const diffInfo = useMemo(() => {
    const oldLines = oldContent.split('\n');
    const newLines = newContent.split('\n');
    
    if (status === 'added') {
      return { 
        additions: newLines.length, 
        deletions: 0,
        addedLines: newLines.map((_, i) => i),
        deletedLines: [],
        modifiedOldLines: [],
        modifiedNewLines: []
      };
    }
    if (status === 'deleted') {
      return { 
        additions: 0, 
        deletions: oldLines.length,
        addedLines: [],
        deletedLines: oldLines.map((_, i) => i),
        modifiedOldLines: [],
        modifiedNewLines: []
      };
    }
    
    const diff = computeDiff(oldLines, newLines);
    
    return { 
      additions: diff.addedLines.length + diff.modifiedNewLines.length, 
      deletions: diff.deletedLines.length + diff.modifiedOldLines.length,
      ...diff
    };
  }, [oldContent, newContent, status]);

  // Apply line markers to editors
  useEffect(() => {
    const applyMarkers = (editor: any, lines: number[], className: string) => {
      if (!editor || !editor.session) return;
      
      // Clear existing markers
      const markers = editor.session.getMarkers(false);
      if (markers) {
        Object.keys(markers).forEach(id => {
          editor.session.removeMarker(parseInt(id));
        });
      }
      
      // Add new markers
      const Range = (window as any).ace?.require('ace/range')?.Range;
      if (Range) {
        lines.forEach(lineNum => {
          const range = new Range(lineNum, 0, lineNum, 1);
          editor.session.addMarker(range, className, 'fullLine', true);
        });
      }
    };

    // Small delay to ensure editors are ready
    const timeout = setTimeout(() => {
      if (oldEditorRef.current) {
        const deletedAndModified = [...diffInfo.deletedLines, ...diffInfo.modifiedOldLines];
        applyMarkers(oldEditorRef.current, deletedAndModified, 'diff-line-deleted');
      }
      if (newEditorRef.current) {
        const addedAndModified = [...diffInfo.addedLines, ...diffInfo.modifiedNewLines];
        applyMarkers(newEditorRef.current, addedAndModified, 'diff-line-added');
      }
    }, 100);

    return () => clearTimeout(timeout);
  }, [diffInfo, oldContent, newContent]);

  return (
    <div className="diff-viewer">
      <div className="diff-viewer__header">
        <div className="diff-viewer__file-info">
          <FileIcon />
          <span className="diff-viewer__file-name">{fileName}</span>
          <span className="diff-viewer__file-path">{filePath}</span>
        </div>
        <div className="diff-viewer__stats">
          <span className={`diff-viewer__status diff-viewer__status--${status}`}>
            {status === 'added' ? 'Added' : status === 'deleted' ? 'Deleted' : 'Modified'}
          </span>
          {diffInfo.additions > 0 && (
            <span className="diff-viewer__stat diff-viewer__stat--add">
              <PlusIcon /> +{diffInfo.additions}
            </span>
          )}
          {diffInfo.deletions > 0 && (
            <span className="diff-viewer__stat diff-viewer__stat--delete">
              <XIcon /> -{diffInfo.deletions}
            </span>
          )}
        </div>
      </div>

      <div className="diff-viewer__content">
        {status === 'added' ? (
          // Only show new content for added files
          <div className="diff-viewer__panel diff-viewer__panel--full diff-viewer__panel--new">
            <div className="diff-viewer__panel-header diff-viewer__panel-header--new">
              <span>New File</span>
            </div>
            <div className="diff-viewer__editor">
              <CodeEditor
                mode="json"
                value={newContent}
                readOnly={true}
                width="100%"
                height="100%"
                showPrintMargin={false}
                name="diff-new"
                onLoad={(editor: any) => { newEditorRef.current = editor; }}
              />
            </div>
          </div>
        ) : status === 'deleted' ? (
          // Only show old content for deleted files
          <div className="diff-viewer__panel diff-viewer__panel--full diff-viewer__panel--old">
            <div className="diff-viewer__panel-header diff-viewer__panel-header--old">
              <span>Deleted File</span>
            </div>
            <div className="diff-viewer__editor">
              <CodeEditor
                mode="json"
                value={oldContent}
                readOnly={true}
                width="100%"
                height="100%"
                showPrintMargin={false}
                name="diff-old"
                onLoad={(editor: any) => { oldEditorRef.current = editor; }}
              />
            </div>
          </div>
        ) : (
          // Side by side diff for modified files
          <>
            <div className="diff-viewer__panel diff-viewer__panel--old">
              <div className="diff-viewer__panel-header diff-viewer__panel-header--old">
                <span>Original</span>
              </div>
              <div className="diff-viewer__editor">
                <CodeEditor
                  mode="json"
                  value={oldContent}
                  readOnly={true}
                  width="100%"
                  height="100%"
                  showPrintMargin={false}
                  name="diff-old"
                  onLoad={(editor: any) => { oldEditorRef.current = editor; }}
                />
              </div>
            </div>
            <div className="diff-viewer__divider" />
            <div className="diff-viewer__panel diff-viewer__panel--new">
              <div className="diff-viewer__panel-header diff-viewer__panel-header--new">
                <span>Changed</span>
              </div>
              <div className="diff-viewer__editor">
                <CodeEditor
                  mode="json"
                  value={newContent}
                  readOnly={true}
                  width="100%"
                  height="100%"
                  showPrintMargin={false}
                  name="diff-new"
                  onLoad={(editor: any) => { newEditorRef.current = editor; }}
                />
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
};

export default DiffViewer;

