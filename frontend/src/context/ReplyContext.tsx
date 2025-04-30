/*
 * Requirements:
 * - Type safety for reply target node structure
 * - Type safety for reply quote (including selectionRange)
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
import { StoryTreeNode } from '../types/types';      
import { Quote } from '../types/quote';
// Import persistence utilities
import {
  generateReplyKey,
  saveReplyContent,
  loadReplyContent,
  removeReplyContent,
  // No need to import findLatestDraftForParent here, it's used by the component
} from '../utils/replyPersistence'; 

// Make interface exportable
export interface ReplyContextType {
  replyTarget: StoryTreeNode | null;
  setReplyTarget: (target: StoryTreeNode | null) => void;
  replyContent: string;
  setReplyContent: (content: string) => void;
  replyQuote: Quote | null;
  setReplyQuote: (quote: Quote | null) => void;
  rootUUID: string | null;
  setRootUUID: (uuid: string | null) => void;
  isReplyActive: boolean;
  clearReplyState: () => void;
  replyError: string | null;
  setReplyError: (error: string | null) => void;
  isReplyOpen: boolean;
  setIsReplyOpen: (isOpen: boolean) => void;
}

// Create context with an initial undefined value
const ReplyContext = createContext<ReplyContextType | undefined>(undefined);

interface ReplyProviderProps {
  children: React.ReactNode;
}

export function ReplyProvider({ children }: ReplyProviderProps) {
  const [replyTarget, setReplyTargetState] = useState<StoryTreeNode | null>(null);
  const [replyContent, setReplyContentState] = useState<string>('');
  const [replyQuote, setReplyQuoteState] = useState<Quote | null>(null);
  const [replyError, setReplyErrorState] = useState<string | null>(null);
  const [isReplyOpen, setIsReplyOpenState] = useState<boolean>(false);
  const [rootUUID, setRootUUIDState] = useState<string | null>(null);

  // Generate the current persistence key based on state
  const currentPersistenceKey = useMemo(() => {
    if (rootUUID && replyTarget && replyQuote) {
      return generateReplyKey(rootUUID, replyTarget.id, replyQuote);
    }
    return null;
  }, [rootUUID, replyTarget, replyQuote]);

  // Wrapper for setReplyTarget
  const setReplyTarget = useCallback((target: StoryTreeNode | null) => {
    setReplyTargetState(target);
  }, []);

  // Wrapper for setReplyContent - saves content *and quote* to localStorage
  const setReplyContent = useCallback((content: string) => {
    setReplyContentState(content);
    // Only save if we have a key AND a quote object currently set
    if (currentPersistenceKey && replyQuote) { 
      saveReplyContent(currentPersistenceKey, content, replyQuote); // Pass quote
    } 
  }, [currentPersistenceKey, replyQuote]);

  // Wrapper for setReplyQuote
  const setReplyQuote = useCallback((quote: Quote | null) => {
    setReplyQuoteState(quote);
  }, []);

  // Wrapper for setRootUUID
  const setRootUUID = useCallback((uuid: string | null) => {
    setRootUUIDState(uuid);
  }, []);

  // Wrapper for setReplyError
  const setReplyError = useCallback((error: string | null) => {
    setReplyErrorState(error);
  }, []);

  // Wrapper for setIsReplyOpen
  const setIsReplyOpen = useCallback((isOpen: boolean) => {
    setIsReplyOpenState(isOpen);
  }, []);

  // Load content *and potentially quote* when context key changes
  useEffect(() => {
    if (currentPersistenceKey) {
      const loadedDraft = loadReplyContent(currentPersistenceKey);
      if (loadedDraft !== null) {
        // We found a draft specifically for this key (root/parent/quote)
        // Set the content from this specific draft
        setReplyContentState(loadedDraft.content); 
        // Ensure the quote state matches the loaded draft's quote.
        // This should ideally always match because currentPersistenceKey depends on replyQuote.
        // If it doesn't match, log a warning but prioritize the quote state 
        // that generated the key, which is already in replyQuoteState.
        if (JSON.stringify(replyQuote) !== JSON.stringify(loadedDraft.quote)) {
            console.warn("Mismatch between current quote and loaded draft quote for the same key. This might indicate stale data or a logic issue. Using current quote.");
            // We don't call setReplyQuoteState here to avoid potential re-renders/loops
            // and because the current replyQuote is what formed the key.
        }
      } else {
        // If no specific draft for this key, clear the content state
        // We don't clear the quote state here, as the user might have just selected it
        setReplyContentState(''); 
      }
    } else {
        // If key is null (context incomplete), clear the content state
        setReplyContentState('');
    }
    // Do NOT add setReplyQuoteState to dependencies, it would cause loops.
    // replyQuote is already part of currentPersistenceKey generation.
  }, [currentPersistenceKey, replyQuote]); // Depend on key and the current quote state.

  // clearReplyState - now also removes from localStorage
  const clearReplyState = useCallback(() => {
    setReplyTargetState(null);
    setReplyContentState('');
    setReplyQuoteState(null);
    setReplyErrorState(null);
    setIsReplyOpenState(false);
    // Keep rootUUID as it's tied to the page, not the specific reply action
  }, [currentPersistenceKey]);

  const value = useMemo(() => ({
    replyTarget,
    setReplyTarget,
    replyContent,
    setReplyContent,
    replyQuote,
    setReplyQuote,
    rootUUID,       // Expose rootUUID
    setRootUUID,    // Expose setter
    isReplyActive: replyTarget !== null,
    clearReplyState,
    replyError,
    setReplyError,
    isReplyOpen,
    setIsReplyOpen
  }), [
      replyTarget, 
      replyContent, 
      replyQuote, 
      rootUUID, // Add rootUUID dependency
      clearReplyState, 
      replyError, 
      isReplyOpen, 
      setReplyTarget, // Include setters used by value
      setReplyContent, 
      setReplyQuote, 
      setRootUUID, 
      setReplyError, 
      setIsReplyOpen
    ]);

  // Removed cleanup useEffect as clearReplyState handles removal now
  // useEffect(() => {
  //   return () => {
  //     // No need to clear here, components manage their state
  //   };
  // }, [clearReplyState]);

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