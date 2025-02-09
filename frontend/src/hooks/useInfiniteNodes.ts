/**
 * Requirements:
 * - Handle infinite loading of nodes with pagination
 * - Support loading nodes in batches for performance
 * - Maintain loading states and error handling
 * - TypeScript support with proper types
 * - Yarn for package management
 */

import { useState, useCallback, useRef } from 'react';
import { StoryTreeLevel } from '../context/types';

interface InfiniteNodesState<T> {
  nodes: T[];
  isLoading: boolean;
  error: Error | null;
}

interface UseInfiniteNodesResult<T> {
  nodes: T[];
  isLoading: boolean;
  error: Error | null;
  loadMoreItems: (startIndex: number, stopIndex: number) => Promise<void>;
  isItemLoaded: (index: number) => boolean;
  reset: () => void;
}

type LoadNodesFn<T> = (startIndex: number, stopIndex: number) => Promise<T[]>;

export function useInfiniteNodes<T extends StoryTreeLevel>(
  loadNodes: LoadNodesFn<T>,
  enabled: boolean
): UseInfiniteNodesResult<T> {
  const [state, setState] = useState<InfiniteNodesState<T>>({
    nodes: [],
    isLoading: false,
    error: null,
  });

  // Keep track of which items we've tried to load
  const loadedIndexesRef = useRef<Set<number>>(new Set());

  const isItemLoaded = useCallback(
    (index: number): boolean => {
      return state.nodes[index] !== undefined;
    },
    [state.nodes]
  );

  const loadMoreItems = useCallback(
    async (startIndex: number, stopIndex: number): Promise<void> => {
      if (!enabled || state.isLoading) {
        return;
      }

      // Check if we've already tried loading these indexes
      const newIndexes = Array.from({ length: stopIndex - startIndex + 1 }, (_, i) => startIndex + i)
        .filter(index => !loadedIndexesRef.current.has(index));

      if (newIndexes.length === 0) {
        return;
      }

      setState(prev => ({ ...prev, isLoading: true, error: null }));

      try {
        const newNodes = await loadNodes(startIndex, stopIndex);
        
        // Mark these indexes as attempted
        newIndexes.forEach(index => loadedIndexesRef.current.add(index));

        setState(prev => {
          const updatedNodes = [...prev.nodes];
          newNodes.forEach((node, index) => {
            updatedNodes[startIndex + index] = node;
          });

          return {
            nodes: updatedNodes,
            isLoading: false,
            error: null,
          };
        });
      } catch (error) {
        setState(prev => ({
          ...prev,
          isLoading: false,
          error: error instanceof Error ? error : new Error('Failed to load nodes'),
        }));
      }
    },
    [enabled, state.isLoading, loadNodes]
  );

  const reset = useCallback(() => {
    setState({
      nodes: [],
      isLoading: false,
      error: null,
    });
    loadedIndexesRef.current.clear();
  }, []);

  return {
    nodes: state.nodes,
    isLoading: state.isLoading,
    error: state.error,
    loadMoreItems,
    isItemLoaded,
    reset,
  };
} 