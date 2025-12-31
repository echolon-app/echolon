import React, { useState, useRef, useCallback, useEffect } from 'react';
import './ResizablePanel.css';

export interface ResizablePanelProps {
  children: React.ReactNode;
  direction?: 'horizontal' | 'vertical';
  defaultSize?: number;
  minSize?: number;
  maxSize?: number;
  onResize?: (size: number) => void;
  className?: string;
  handlePosition?: 'start' | 'end';
}

export const ResizablePanel: React.FC<ResizablePanelProps> = ({
  children,
  direction = 'horizontal',
  defaultSize = 300,
  minSize = 100,
  maxSize = 800,
  onResize,
  className = '',
  handlePosition = 'end',
}) => {
  const [size, setSize] = useState(defaultSize);
  const [isResizing, setIsResizing] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);
  const startPosRef = useRef(0);
  const startSizeRef = useRef(0);

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    setIsResizing(true);
    startPosRef.current = direction === 'horizontal' ? e.clientX : e.clientY;
    startSizeRef.current = size;
    document.body.style.cursor = direction === 'horizontal' ? 'col-resize' : 'row-resize';
    document.body.style.userSelect = 'none';
  }, [direction, size]);

  const handleMouseMove = useCallback((e: MouseEvent) => {
    if (!isResizing) return;

    const currentPos = direction === 'horizontal' ? e.clientX : e.clientY;
    const diff = handlePosition === 'end' 
      ? currentPos - startPosRef.current
      : startPosRef.current - currentPos;
    
    let newSize = startSizeRef.current + diff;
    newSize = Math.max(minSize, Math.min(maxSize, newSize));

    setSize(newSize);
    onResize?.(newSize);
  }, [isResizing, direction, handlePosition, minSize, maxSize, onResize]);

  const handleMouseUp = useCallback(() => {
    setIsResizing(false);
    document.body.style.cursor = '';
    document.body.style.userSelect = '';
  }, []);

  useEffect(() => {
    if (isResizing) {
      document.addEventListener('mousemove', handleMouseMove);
      document.addEventListener('mouseup', handleMouseUp);
    }

    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };
  }, [isResizing, handleMouseMove, handleMouseUp]);

  const style = direction === 'horizontal'
    ? { width: size }
    : { height: size };

  return (
    <div
      ref={panelRef}
      className={`resizable-panel resizable-panel--${direction} resizable-panel--handle-${handlePosition} ${isResizing ? 'resizable-panel--resizing' : ''} ${className}`}
      style={style}
    >
      {handlePosition === 'start' && (
        <div
          className="resizable-panel__handle"
          onMouseDown={handleMouseDown}
        />
      )}
      <div className="resizable-panel__content">
        {children}
      </div>
      {handlePosition === 'end' && (
        <div
          className="resizable-panel__handle"
          onMouseDown={handleMouseDown}
        />
      )}
    </div>
  );
};

// Component for creating resizable split layouts
export interface ResizableSplitProps {
  children: [React.ReactNode, React.ReactNode] | [React.ReactNode, React.ReactNode, React.ReactNode];
  direction?: 'horizontal' | 'vertical';
  sizes?: number[];
  minSizes?: number[];
  onSizesChange?: (sizes: number[]) => void;
  className?: string;
}

export const ResizableSplit: React.FC<ResizableSplitProps> = ({
  children,
  direction = 'horizontal',
  sizes: initialSizes,
  minSizes = [100, 100],
  onSizesChange,
  className = '',
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const [sizes, setSizes] = useState<number[]>(initialSizes || []);
  const [activeHandle, setActiveHandle] = useState<number | null>(null);
  const startPosRef = useRef(0);
  const startSizesRef = useRef<number[]>([]);

  useEffect(() => {
    if (!initialSizes && containerRef.current) {
      const totalSize = direction === 'horizontal'
        ? containerRef.current.offsetWidth
        : containerRef.current.offsetHeight;
      const equalSize = totalSize / children.length;
      setSizes(children.map(() => equalSize));
    }
  }, [children.length, direction, initialSizes]);

  const handleMouseDown = (e: React.MouseEvent, handleIndex: number) => {
    e.preventDefault();
    setActiveHandle(handleIndex);
    startPosRef.current = direction === 'horizontal' ? e.clientX : e.clientY;
    startSizesRef.current = [...sizes];
    document.body.style.cursor = direction === 'horizontal' ? 'col-resize' : 'row-resize';
    document.body.style.userSelect = 'none';
  };

  const handleMouseMove = useCallback((e: MouseEvent) => {
    if (activeHandle === null) return;

    const currentPos = direction === 'horizontal' ? e.clientX : e.clientY;
    const diff = currentPos - startPosRef.current;

    const newSizes = [...startSizesRef.current];
    const minLeft = minSizes[activeHandle] || 100;
    const minRight = minSizes[activeHandle + 1] || 100;

    const newLeftSize = Math.max(minLeft, newSizes[activeHandle] + diff);
    const newRightSize = Math.max(minRight, newSizes[activeHandle + 1] - diff);

    if (newLeftSize >= minLeft && newRightSize >= minRight) {
      newSizes[activeHandle] = newLeftSize;
      newSizes[activeHandle + 1] = newRightSize;
      setSizes(newSizes);
      onSizesChange?.(newSizes);
    }
  }, [activeHandle, direction, minSizes, onSizesChange]);

  const handleMouseUp = useCallback(() => {
    setActiveHandle(null);
    document.body.style.cursor = '';
    document.body.style.userSelect = '';
  }, []);

  useEffect(() => {
    if (activeHandle !== null) {
      document.addEventListener('mousemove', handleMouseMove);
      document.addEventListener('mouseup', handleMouseUp);
    }

    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };
  }, [activeHandle, handleMouseMove, handleMouseUp]);

  return (
    <div
      ref={containerRef}
      className={`resizable-split resizable-split--${direction} ${activeHandle !== null ? 'resizable-split--resizing' : ''} ${className}`}
    >
      {React.Children.map(children, (child, index) => (
        <React.Fragment key={index}>
          <div
            className="resizable-split__pane"
            style={direction === 'horizontal' ? { width: sizes[index] } : { height: sizes[index] }}
          >
            {child}
          </div>
          {index < children.length - 1 && (
            <div
              className="resizable-split__handle"
              onMouseDown={(e) => handleMouseDown(e, index)}
            />
          )}
        </React.Fragment>
      ))}
    </div>
  );
};

export default ResizablePanel;

