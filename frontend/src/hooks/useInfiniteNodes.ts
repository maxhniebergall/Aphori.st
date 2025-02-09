/**
 * Requirements:
 * - Create a custom hook for infinite node fetching.
 * - Unify state with the global StoryTreeContext by using global nodes, loading, and error states.
 * - Use StoryTreeContext actions (SET_NODES, SET_LOADING, TRUNCATE_ITEMS) to update the global state.
 * - Provide loadMoreItems callback that fetches additional nodes and appends them to the global state.
 * - Provide isItemLoaded function based on the global nodes array.
 * - Provide reset to clear/truncate nodes via the global state.
 *
 * Changes Made:
 * - Removed the internal useState hooks.
 * - Consumed state and actions from StoryTreeContext.
 * - Updated the loadMoreItems and reset functions to dispatch context actions.
 * - Updated the error type to match StoryTreeContext.
 * - Switched "items" for "nodes" in the result type for better description.
 */

import { useCallback } from 'react';
import { useStoryTree, ACTIONS } from '../context/StoryTreeContext';
import { StoryTreeLevel } from '../context/types';

export interface InfiniteNodesResult<T> {
  nodes: T[];
  isLoading: boolean;
  error: string | null;
  loadMoreItems: (startIndex: number, stopIndex: number) => Promise<void>;
  isItemLoaded: (index: number) => boolean;
  reset: () => void;
}

function useInfiniteNodes<T extends StoryTreeLevel>(
  fetchFn: (startIndex: number, stopIndex: number) => Promise<T[]>,
  hasNextPage: boolean
): InfiniteNodesResult<T> {
  // Get the global state from StoryTreeContext
  const { state, dispatch } = useStoryTree();
  const { nodes, isNextPageLoading, error } = state;

  const loadMoreItems = useCallback(
    async (startIndex: number, stopIndex: number): Promise<void> => {
      if (!hasNextPage || isNextPageLoading) return;
      // Start loading: update global loading state
      dispatch({ type: ACTIONS.SET_LOADING, payload: true });
      try {
        const newItems = await fetchFn(startIndex, stopIndex);
        if (newItems && Array.isArray(newItems)) {
          // Append new nodes to the global state
          dispatch({ type: ACTIONS.SET_NODES, payload: [...nodes, ...newItems] });
        }
      } catch (err: any) {
        console.error('Error loading more items:', err);
        // Optionally, dispatch an error action if needed.
      } finally {
        // End loading: update global loading state
        dispatch({ type: ACTIONS.SET_LOADING, payload: false });
      }
    },
    [dispatch, fetchFn, hasNextPage, isNextPageLoading, nodes]
  );

  const isItemLoaded = useCallback(
    (index: number): boolean => {
      return !!nodes[index];
    },
    [nodes]
  );

  const reset = useCallback((): void => {
    // Resetting nodes: using TRUNCATE_ITEMS with a convention (e.g., payload of -1 indicates a reset)
    dispatch({ type: ACTIONS.TRUNCATE_ITEMS, payload: -1 });
  }, [dispatch]);

  return { nodes: nodes as T[], isLoading: isNextPageLoading, error, loadMoreItems, isItemLoaded, reset };
}

export default useInfiniteNodes; 