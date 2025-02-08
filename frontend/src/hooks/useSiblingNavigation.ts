/*
 * Requirements:
 * - Sibling navigation logic is encapsulated in this hook.
 * - Manage the current sibling index and provide functions to navigate to next and previous siblings.
 * - In non-quote mode, fetch more siblings if needed.
 * - Execute onSiblingChange callback when the active sibling changes.
 */
import { useState, useCallback } from 'react';
import { StoryTreeLevel } from '../context/types';

interface SiblingNavigationParams<T extends StoryTreeLevel> {
  node: T;
  siblings: T[];
  isQuoteMode: boolean;
  siblingsLoading: boolean;
  isLoadingReplies: boolean;
  fetchMoreSiblings?: (startIndex: number, stopIndex: number) => Promise<void>;
  onSiblingChange?: (node: T) => void;
  initialIndex?: number;
}

interface SiblingNavigationResult<T extends StoryTreeLevel> {
  currentSiblingIndex: number;
  setCurrentSiblingIndex: React.Dispatch<React.SetStateAction<number>>;
  loadNextSibling: () => void;
  loadPreviousSibling: () => void;
}

export function useSiblingNavigation<T extends StoryTreeLevel>({
  node,
  siblings,
  isQuoteMode,
  siblingsLoading,
  isLoadingReplies,
  fetchMoreSiblings,
  onSiblingChange,
  initialIndex = 0,
}: SiblingNavigationParams<T>): SiblingNavigationResult<T> {
  const [currentSiblingIndex, setCurrentSiblingIndex] = useState<number>(initialIndex);

  const loadNextSibling = useCallback(async () => {
    if (!node?.storyTree?.id || (!isQuoteMode && siblingsLoading) || isLoadingReplies) return;
    const nextIndex = currentSiblingIndex + 1;
    if (!isQuoteMode && fetchMoreSiblings && nextIndex >= siblings.length) {
      await fetchMoreSiblings(nextIndex, nextIndex + 2);
    }
    setCurrentSiblingIndex(nextIndex);
    if (onSiblingChange && siblings[nextIndex]) {
      onSiblingChange(siblings[nextIndex]);
    }
  }, [
    currentSiblingIndex,
    node,
    siblings,
    isQuoteMode,
    siblingsLoading,
    isLoadingReplies,
    fetchMoreSiblings,
    onSiblingChange,
  ]);

  const loadPreviousSibling = useCallback(async () => {
    if (!node?.storyTree?.id || currentSiblingIndex <= 0 || (!isQuoteMode && siblingsLoading) || isLoadingReplies)
      return;
    const prevIndex = currentSiblingIndex - 1;
    setCurrentSiblingIndex(prevIndex);
    if (onSiblingChange && siblings[prevIndex]) {
      onSiblingChange(siblings[prevIndex]);
    }
  }, [
    currentSiblingIndex,
    node,
    siblings,
    isQuoteMode,
    siblingsLoading,
    isLoadingReplies,
    onSiblingChange,
  ]);

  return {
    currentSiblingIndex,
    setCurrentSiblingIndex, // In case you need to adjust it externally.
    loadNextSibling,
    loadPreviousSibling,
  };
} 