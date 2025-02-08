/*
 * Requirements:
 * - Type safety for reply target node structure
 * - Type safety for selection state
 * - Type safety for reply content
 * - Proper null handling for optional values
 * - React Context typing
 * - Consistent types with main types.ts file
 * - Proper error handling for context usage outside provider
 * - Memory efficient context updates
 * - Safe initialization of context values
 * - Proper cleanup on unmount
 * - Thread-safe state updates
 */

import React, { createContext, useContext, useState, useCallback, useMemo, useEffect } from 'react';
import { StoryTreeMetadata as MainStoryTreeMetadata } from './types';

// Define the structure of a story tree node
interface StoryTreeMetadata extends MainStoryTreeMetadata {}

interface StoryTree {
  id: string;
  text: string;
  nodes?: Array<{ id: string; parentId: string | null }>;
  metadata?: StoryTreeMetadata;
}

interface StoryTreeNode {
  storyTree: StoryTree;
  id?: string;
  siblings?: StoryTreeNode[];
}

interface SelectionState {
  start: number;
  end: number;
}

interface ReplyContextType {
  replyTarget: StoryTreeNode | null;
  setReplyTarget: (target: StoryTreeNode | null) => void;
  replyContent: string;
  setReplyContent: (content: string) => void;
  selectionState: SelectionState | null;
  setSelectionState: (state: SelectionState | null) => void;
  isReplyActive: boolean;
  clearReplyState: () => void;
  replyError: string | null;
  setReplyError: (error: string | null) => void;
}

// Create context with an initial undefined value
const ReplyContext = createContext<ReplyContextType | undefined>(undefined);

interface ReplyProviderProps {
  children: React.ReactNode;
}

export function ReplyProvider({ children }: ReplyProviderProps) {
  const [replyTarget, setReplyTarget] = useState<StoryTreeNode | null>(null);
  const [replyContent, setReplyContent] = useState<string>('');
  const [selectionState, setSelectionState] = useState<SelectionState | null>(null);
  const [replyError, setReplyError] = useState<string | null>(null);

  const clearReplyState = useCallback(() => {
    setReplyTarget(null);
    setReplyContent('');
    setSelectionState(null);
    setReplyError(null);
  }, []);

  const value = useMemo(() => ({
    replyTarget,
    setReplyTarget,
    replyContent,
    setReplyContent,
    selectionState,
    setSelectionState,
    isReplyActive: replyTarget !== null,
    clearReplyState,
    replyError,
    setReplyError
  }), [replyTarget, replyContent, selectionState, clearReplyState, replyError]);

  useEffect(() => {
    return () => {
      clearReplyState();
    };
  }, [clearReplyState]);

  return (
    <ReplyContext.Provider value={value}>
      {children}
    </ReplyContext.Provider>
  );
}

export function useReplyContext(): ReplyContextType {
  const context = useContext(ReplyContext);
  if (context === undefined) {
    throw new Error('useReplyContext must be used within a ReplyProvider');
  }
  return context;
} 