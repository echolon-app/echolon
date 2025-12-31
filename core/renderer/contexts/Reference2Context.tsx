import React, { createContext, useContext, useState, useCallback, useRef, ReactNode } from 'react';

interface Reference2ContextType {
  // Active section for highlighting in sidebar
  activeSectionId: string | null;
  setActiveSectionId: (id: string | null) => void;
  
  // Scroll to section function (set by Reference2 tab, called by LeftPanel)
  scrollToSection: ((sectionId: string) => void) | null;
  registerScrollToSection: (fn: ((sectionId: string) => void) | null) => void;
  
  // Track which collection tab has Reference2 active
  activeReference2CollectionId: string | null;
  setActiveReference2CollectionId: (id: string | null) => void;
  
  // Section refs for scroll observation
  sectionRefs: React.MutableRefObject<Map<string, HTMLDivElement>>;
  contentRef: React.RefObject<HTMLDivElement | null>;
  registerContentRef: (ref: HTMLDivElement | null) => void;
}

const Reference2Context = createContext<Reference2ContextType | null>(null);

export const Reference2Provider: React.FC<{ children: ReactNode }> = ({ children }) => {
  const [activeSectionIdState, setActiveSectionIdState] = useState<string | null>(null);
  const [scrollToSectionFn, setScrollToSectionFn] = useState<((sectionId: string) => void) | null>(null);
  const [activeCollectionIdState, setActiveCollectionIdState] = useState<string | null>(null);
  const sectionRefs = useRef<Map<string, HTMLDivElement>>(new Map());
  const contentRef = useRef<HTMLDivElement | null>(null);

  const setActiveSectionId = useCallback((id: string | null) => {
    setActiveSectionIdState(id);
  }, []);

  const setActiveReference2CollectionId = useCallback((id: string | null) => {
    setActiveCollectionIdState(id);
  }, []);

  const registerScrollToSection = useCallback((fn: ((sectionId: string) => void) | null) => {
    setScrollToSectionFn(() => fn);
  }, []);

  const registerContentRef = useCallback((ref: HTMLDivElement | null) => {
    contentRef.current = ref;
  }, []);

  return (
    <Reference2Context.Provider
      value={{
        activeSectionId: activeSectionIdState,
        setActiveSectionId,
        scrollToSection: scrollToSectionFn,
        registerScrollToSection,
        activeReference2CollectionId: activeCollectionIdState,
        setActiveReference2CollectionId,
        sectionRefs,
        contentRef,
        registerContentRef,
      }}
    >
      {children}
    </Reference2Context.Provider>
  );
};

export const useReference2 = (): Reference2ContextType => {
  const context = useContext(Reference2Context);
  if (!context) {
    throw new Error('useReference2 must be used within Reference2Provider');
  }
  return context;
};

// Optional hook that returns null if not in provider (for components that may be outside)
export const useReference2Optional = (): Reference2ContextType | null => {
  return useContext(Reference2Context);
};

