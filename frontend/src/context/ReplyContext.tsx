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
import { StoryTreeLevel } from '../types/types';      
import { Quote } from '../types/quote';

interface ReplyContextType {
  replyTarget: StoryTreeLevel | null;
  setReplyTarget: (target: StoryTreeLevel | null) => void;
  replyContent: string;
  setReplyContent: (content: string) => void;
  replyQuote: Quote | null;
  setReplyQuote: (quote: Quote | null) => void;
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
  const [replyTarget, setReplyTarget] = useState<StoryTreeLevel | null>(null);
  const [replyContent, setReplyContent] = useState<string>('');
  const [replyQuote, setReplyQuote] = useState<Quote | null>(null);
  const [replyError, setReplyError] = useState<string | null>(null);
  const [isReplyOpen, setIsReplyOpen] = useState<boolean>(false);

  const clearReplyState = useCallback(() => {
    setReplyTarget(null);
    setReplyContent('');
    setReplyQuote(null);
    setReplyError(null);
    setIsReplyOpen(false);
  }, []);

  const value = useMemo(() => ({
    replyTarget,
    setReplyTarget,
    replyContent,
    setReplyContent,
    replyQuote,
    setReplyQuote,
    isReplyActive: replyTarget !== null,
    clearReplyState,
    replyError,
    setReplyError,
    isReplyOpen,
    setIsReplyOpen
  }), [replyTarget, replyContent, replyQuote, clearReplyState, replyError, isReplyOpen]);

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