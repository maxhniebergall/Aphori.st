/**
 * Requirements:
 * - Handle loading and navigation of sibling nodes
 * - Support both quote mode and regular sibling navigation
 * - Cache loaded siblings to prevent unnecessary fetches
 * - Manage loading states and error handling
 * - TypeScript support with proper types
 * - Yarn for package management
 */

import { useState, useCallback, useRef, useEffect } from 'react';
import { StoryTreeLevel } from '../context/types';
import { storyTreeOperator } from '../operators/StoryTreeOperator';

interface SiblingNavigationState<T> {
  siblings: T[];
  currentIndex: number;
  isLoading: boolean;
  error: Error | null;
  totalCount: number;
}

interface SiblingNavigationResult<T> {
  currentNode: T | null;
  siblings: T[];
  currentIndex: number;
  isLoading: boolean;
  error: Error | null;
  hasNextSibling: boolean;
  hasPreviousSibling: boolean;
  loadNextSibling: () => Promise<void>;
  loadPreviousSibling: () => Promise<void>;
  reset: () => void;
}

interface SiblingNavigationOptions<T> {
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

export function useSiblingNavigation<T extends StoryTreeLevel>({
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
  // State to track loaded siblings and navigation
  const [state, setState] = useState<SiblingNavigationState<T>>({
    siblings: siblings,
    currentIndex: initialIndex,
    isLoading: siblingsLoading || isLoadingReplies,
    error: null,
    totalCount: node.storyTree?.nodes?.length || 1
  });

  // Cache for loaded siblings to prevent unnecessary fetches
  const loadedSiblingsCache = useRef<Map<string, T>>(new Map());

  // Helper function to load a batch of siblings
  const loadSiblingBatch = async (siblingNodes: Array<{ id: string }>) => {
    const loadedNodes = await Promise.all(
      siblingNodes.map(async (sibling) => {
        if (!sibling?.id) return null;

        // Check cache first
        const cachedNode = loadedSiblingsCache.current.get(sibling.id);
        if (cachedNode) return cachedNode;

        // If it's the current node, use it directly
        if (sibling.id === node.storyTree?.id) {
          loadedSiblingsCache.current.set(sibling.id, node);
          return node;
        }

        // Otherwise fetch the node
        try {
          const fetchedNode = await storyTreeOperator.fetchNode(sibling.id);
          if (fetchedNode) {
            const typedNode = fetchedNode as T;
            loadedSiblingsCache.current.set(sibling.id, typedNode);
            return typedNode;
          }
        } catch (error) {
          console.error(`Failed to fetch sibling node ${sibling.id}:`, error);
        }
        return null;
      })
    );

    // Filter out null values and ensure type safety
    const validNodes = loadedNodes.filter((node): node is NonNullable<Awaited<T>> => node !== null);
    return validNodes;
  };

  // Load initial siblings
  useEffect(() => {
    const loadInitialSiblings = async () => {
      if (!node.storyTree?.id || isQuoteMode) return;

      setState(prev => ({ ...prev, isLoading: true, error: null }));

      try {
        // Load initial batch of siblings
        const initialBatch = node.storyTree.nodes.slice(0, batchSize);
        const loadedSiblings = await loadSiblingBatch(initialBatch);
        
        setState(prev => ({
          ...prev,
          siblings: loadedSiblings as T[],
          isLoading: false,
          error: null
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
  }, [node.storyTree?.id, isQuoteMode, batchSize]);

  const loadNextSibling = useCallback(async () => {
    if (state.isLoading || !node.storyTree?.nodes) return;
    
    const nextIndex = state.currentIndex + 1;
    if (nextIndex >= state.totalCount) return;

    setState(prev => ({ ...prev, isLoading: true, error: null }));

    try {
      // Ensure the next sibling is loaded
      if (nextIndex >= state.siblings.length) {
        const nextBatch = node.storyTree.nodes.slice(
          state.siblings.length,
          state.siblings.length + batchSize
        );
        const newSiblings = await loadSiblingBatch(nextBatch);
        
        setState(prev => ({
          ...prev,
          siblings: [...prev.siblings, ...(newSiblings as T[])],
          currentIndex: nextIndex,
          isLoading: false
        }));
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
  }, [state, node.storyTree?.nodes, batchSize, onSiblingChange]);

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
      totalCount: node.storyTree?.nodes?.length || 1
    });
    loadedSiblingsCache.current.clear();
  }, [initialIndex, node.storyTree?.nodes?.length]);

  return {
    currentNode: state.siblings[state.currentIndex] || null,
    siblings: state.siblings,
    currentIndex: state.currentIndex,
    isLoading: state.isLoading,
    error: state.error,
    hasNextSibling: state.currentIndex < state.totalCount - 1,
    hasPreviousSibling: state.currentIndex > 0,
    loadNextSibling,
    loadPreviousSibling,
    reset
  };
} 