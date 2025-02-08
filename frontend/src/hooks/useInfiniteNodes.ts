/**
 * Requirements:
 * - Create a custom hook for infinite node fetching
 * - Maintain local state for items, loading state, and error state
 * - Support asynchronous fetching with proper error handling
 * - Provide a loadMoreItems callback to be used by infinite loaders
 * - Provide an isItemLoaded function to check if an item has been loaded
 * - Allow resetting the fetched results 
 * - Written in TypeScript using generics for flexibility
 */

import { useState, useCallback } from 'react';

export interface InfiniteNodesResult<T> {
  items: T[];
  isLoading: boolean;
  error: Error | null;
  loadMoreItems: (startIndex: number, stopIndex: number) => Promise<void>;
  isItemLoaded: (index: number) => boolean;
  reset: () => void;
}

function useInfiniteNodes<T>(
  initialItems: T[],
  fetchFn: (startIndex: number, stopIndex: number) => Promise<T[]>,
  hasNextPage: boolean
): InfiniteNodesResult<T> {
  const [items, setItems] = useState<T[]>(initialItems);
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [error, setError] = useState<Error | null>(null);

  const loadMoreItems = useCallback(async (startIndex: number, stopIndex: number): Promise<void> => {
    if (!hasNextPage || isLoading) return;
    setIsLoading(true);
    try {
      const newItems = await fetchFn(startIndex, stopIndex);
      setItems((prevItems) => {
        // Ensure we create a new array with the new items inserted at the proper indices.
        const updatedItems = [...prevItems];
        newItems.forEach((item, idx) => {
          updatedItems[startIndex + idx] = item;
        });
        return updatedItems;
      });
    } catch (err: any) {
      setError(err);
    } finally {
      setIsLoading(false);
    }
  }, [fetchFn, hasNextPage, isLoading]);

  const isItemLoaded = useCallback((index: number): boolean => {
    return !!items[index];
  }, [items]);

  const reset = useCallback(() => {
    setItems(initialItems);
    setError(null);
  }, [initialItems]);

  return { items, isLoading, error, loadMoreItems, isItemLoaded, reset };
}

export default useInfiniteNodes; 