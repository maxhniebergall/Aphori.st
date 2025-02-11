/**
 * Requirements:
 * - Handle loading and navigation of sibling nodes
 * - Support both quote mode and regular sibling navigation
 * - Cache loaded siblings to prevent unnecessary fetches
 * - Manage loading states and error handling
 * - TypeScript support with proper types
 * - Yarn for package management
 * - Debug logging for sibling navigation
 */

import { useCallback, useRef, useEffect, useState } from 'react';
import { StoryTreeLevel, StoryTreeNode } from '../context/types';
import { storyTreeOperator } from '../operators/StoryTreeOperator';

interface SiblingState<T extends StoryTreeLevel> {
  siblings: T[];
  currentIndex: number;
  isLoading: boolean;
  error: Error | null;
  totalCount: number;
}

interface SiblingNavigationResult<T extends StoryTreeLevel> {
  currentNode: T | null;
  siblings: T[];
  currentIndex: number;
  isLoading: boolean;
  error: Error | null;
  hasNextSibling: boolean;
  hasPreviousSibling: boolean;
  navigateToNextSibling: () => Promise<void>;
  navigateToPreviousSibling: () => Promise<void>;
  reset: () => void;
}

interface SiblingNavigationOptions<T extends StoryTreeLevel> {
  node: T;
  isQuoteMode?: boolean;
  initialIndex?: number;
  onSiblingChange?: (node: T) => void;
  batchSize?: number;
  siblings?: T[];
  siblingsLoading?: boolean;
  isLoadingReplies?: boolean;
  fetchMoreSiblings?: (startIndex: number, stopIndex: number) => Promise<void>;
}

export function useSiblingNavigation<T extends StoryTreeLevel = StoryTreeLevel>({
  node,
  isQuoteMode = false,
  initialIndex = 0,
  onSiblingChange,
  batchSize = 3,
  siblings = [],
  siblingsLoading = false,
  isLoadingReplies = false,
  fetchMoreSiblings = async () => {}
}: SiblingNavigationOptions<T>): SiblingNavigationResult<T> {
  // State management
  const [state, setState] = useState<SiblingState<T>>({
    siblings: [],
    currentIndex: initialIndex,
    isLoading: false,
    error: null,
    totalCount: 1
  });

  // Cache for loaded siblings to prevent unnecessary fetches
  const loadedSiblingsCache = useRef<Map<string, T>>(new Map());

  // Helper function to convert StoryTreeNode to StoryTreeLevel
  const convertNodeToLevel = (node: StoryTreeNode, parentLevel: StoryTreeLevel): StoryTreeLevel => ({
    rootNodeId: parentLevel.rootNodeId,
    levelNumber: parentLevel.levelNumber + 1,
    textContent: node.textContent,
    siblings: { levelsMap: new Map() }
  });

  // Helper function to load a batch of siblings
  const loadSiblingBatch = async (siblingNodes: Array<{ id: string }>) => {
    const loadedNodes = new Array<T>();

    for (const sibling of siblingNodes) {
      if (!sibling?.id) continue;

      // Check cache first
      const cachedNode = loadedSiblingsCache.current.get(sibling.id);
      if (cachedNode) {
        loadedNodes.push(cachedNode);
        continue;
      }

      // Otherwise fetch the node
      try {
        const fetchedNode = await storyTreeOperator.fetchNode(sibling.id);
        if (fetchedNode) {
          const typedNode = {
            ...fetchedNode,
            rootNodeId: fetchedNode.rootNodeId,
            levelNumber: node.levelNumber + 1,
            siblings: { levelsMap: new Map() }
          } as T;
          loadedSiblingsCache.current.set(sibling.id, typedNode);
          loadedNodes.push(typedNode);
        }
      } catch (error) {
        console.error(`Failed to fetch sibling node ${sibling.id}:`, error);
      }
    }

    return loadedNodes;
  };

  // Load initial siblings
  useEffect(() => {
    const loadInitialSiblings = async () => {
      if (!node.rootNodeId || isQuoteMode) return;

      setState(prev => ({ ...prev, isLoading: true, error: null }));

      try {
        // Get initial batch of siblings from the node's siblings map
        const initialSiblings: StoryTreeLevel[] = [];
        node.siblings.levelsMap.forEach((siblings, quote) => {
          initialSiblings.push(...siblings.map(s => convertNodeToLevel(s, node)));
        });

        const loadedSiblings = await loadSiblingBatch(
          initialSiblings.map(s => ({ id: s.rootNodeId }))
        );
        
        setState(prev => ({
          ...prev,
          siblings: loadedSiblings,
          isLoading: false,
          error: null,
          totalCount: node.siblings.levelsMap.size
        }));
      } catch (error) {
        setState(prev => ({
          ...prev,
          isLoading: false,
          error: error instanceof Error ? error : new Error('Failed to load initial siblings')
        }));
      }
    };

    loadInitialSiblings();
  }, [node.rootNodeId, isQuoteMode, batchSize]);

  const loadNextSibling = useCallback(async () => {
    if (state.isLoading || state.currentIndex >= state.totalCount - 1) return;

    const nextIndex = state.currentIndex + 1;
    setState(prev => ({ ...prev, isLoading: true, error: null }));

    try {
      // Ensure the next sibling is loaded
      if (nextIndex >= state.siblings.length) {
        // Get next batch from siblings map
        const nextSiblings: StoryTreeLevel[] = [];
        node.siblings.levelsMap.forEach((siblings, quote) => {
          nextSiblings.push(
            ...siblings
              .slice(state.siblings.length, state.siblings.length + batchSize)
              .map(s => convertNodeToLevel(s, node))
          );
        });

        const newSiblings = await loadSiblingBatch(
          nextSiblings.map(s => ({ id: s.rootNodeId }))
        );
        
        setState(prev => {
          const updatedSiblings = [...prev.siblings];
          newSiblings.forEach((sibling, i) => {
            updatedSiblings[nextIndex + i] = sibling;
          });
          return {
            ...prev,
            siblings: updatedSiblings,
            currentIndex: nextIndex,
            isLoading: false
          };
        });
      } else {
        setState(prev => ({
          ...prev,
          currentIndex: nextIndex,
          isLoading: false
        }));
      }

      // Notify of sibling change
      if (onSiblingChange && state.siblings[nextIndex]) {
        onSiblingChange(state.siblings[nextIndex]);
      }
    } catch (error) {
      setState(prev => ({
        ...prev,
        isLoading: false,
        error: error instanceof Error ? error : new Error('Failed to load next sibling')
      }));
    }
  }, [state, node.siblings, batchSize, onSiblingChange]);

  const loadPreviousSibling = useCallback(async () => {
    if (state.isLoading || state.currentIndex <= 0) return;

    const prevIndex = state.currentIndex - 1;
    setState(prev => ({
      ...prev,
      currentIndex: prevIndex,
      isLoading: false
    }));

    if (onSiblingChange && state.siblings[prevIndex]) {
      onSiblingChange(state.siblings[prevIndex]);
    }
  }, [state.isLoading, state.currentIndex, state.siblings, onSiblingChange]);

  const reset = useCallback(() => {
    setState({
      siblings: [],
      currentIndex: initialIndex,
      isLoading: false,
      error: null,
      totalCount: node.siblings.levelsMap.size
    });
    loadedSiblingsCache.current.clear();
  }, [initialIndex, node.siblings.levelsMap.size]);

  return {
    currentNode: state.siblings[state.currentIndex] || null,
    siblings: state.siblings,
    currentIndex: state.currentIndex,
    isLoading: state.isLoading,
    error: state.error,
    hasNextSibling: state.currentIndex < state.totalCount - 1,
    hasPreviousSibling: state.currentIndex > 0,
    navigateToNextSibling: loadNextSibling,
    navigateToPreviousSibling: loadPreviousSibling,
    reset
  };
} 