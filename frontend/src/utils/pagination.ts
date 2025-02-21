/*
 * Requirements:
 * - Standardized cursor-based pagination implementation
 * - Type-safe cursor encoding/decoding
 * - Reusable pagination hooks and utilities
 * - Consistent pagination state management
 * - Support for both forward and backward pagination
 * 
 * TODO:
 * - If backward pagination becomes necessary, we should add a `loadPrevious` function
 *   and update the `reset` function to reset both `nextCursor` and `prevCursor`.
 */

import { useCallback, useState } from 'react';

export interface Cursor {
  id: string;
  timestamp: number;
  type: 'story' | 'reply';
}

export interface PaginationState<T> {
  items: T[];
  nextCursor?: string;
  prevCursor?: string;
  hasMore: boolean;
  matchingItemsCount: number;
  isLoading: boolean;
  error?: string;
}

export interface PaginationOptions {
  limit?: number;
  initialCursor?: string;
}

export interface FetchItemsResponse<T> {
  data: T[];
  pagination: {
    nextCursor?: string;
    prevCursor?: string;
    hasMore: boolean;
    matchingItemsCount: number;
  };
}

export function encodeCursor(cursor: Cursor): string {
  return Buffer.from(JSON.stringify(cursor)).toString('base64');
}

export function decodeCursor(encodedCursor: string): Cursor {
  try {
    return JSON.parse(Buffer.from(encodedCursor, 'base64').toString());
  } catch (error) {
    throw new Error('Invalid cursor format');
  }
}

export function createCursor(id: string, timestamp: number, type: 'story' | 'reply'): string {
  return encodeCursor({ id, timestamp, type });
}

// Helper function to deduplicate items by ID
function mergeItems<T extends { id: string }>(oldItems: T[], newItems: T[]): T[] {
  const seen = new Set(oldItems.map(item => item.id));
  return [...oldItems, ...newItems.filter(item => !seen.has(item.id))];
}

export function usePagination<T extends { id: string }>(
  fetchItems: (cursor: string | undefined, limit: number) => Promise<FetchItemsResponse<T>>,
  options: PaginationOptions = {}
) {
  const { limit = 10, initialCursor } = options;
  
  const [state, setState] = useState<PaginationState<T>>({
    items: [],
    hasMore: true,
    matchingItemsCount: 0,
    isLoading: false,
    nextCursor: initialCursor,
  });

  const loadMore = useCallback(async (reset: boolean = false) => {
    if (state.isLoading || (!state.hasMore && !reset)) return;

    setState(prev => ({ ...prev, isLoading: true, error: undefined }));

    try {
      const cursor = reset ? undefined : state.nextCursor;
      const response = await fetchItems(cursor, limit);

      setState(prev => ({
        items: reset ? response.data : mergeItems(prev.items, response.data),
        nextCursor: response.pagination.nextCursor,
        prevCursor: response.pagination.prevCursor,
        hasMore: response.pagination.hasMore,
        matchingItemsCount: response.pagination.matchingItemsCount,
        isLoading: false,
      }));
    } catch (error) {
      setState(prev => ({
        ...prev,
        isLoading: false,
        error: error instanceof Error ? error.message : 'Failed to load items',
      }));
    }
  }, [fetchItems, limit, state.isLoading, state.hasMore, state.nextCursor]);

  const reset = useCallback(() => {
    setState({
      items: [],
      hasMore: true,
      matchingItemsCount: 0,
      isLoading: false,
      nextCursor: undefined,
      prevCursor: undefined,
      error: undefined
    });
    // Avoid race conditions by using setTimeout
    setTimeout(() => loadMore(true), 0);
  }, [loadMore]);

  return {
    ...state,
    loadMore,
    reset,
  };
}

// Helper function to create a fetchItems function for a specific API endpoint
export function createPaginatedFetcher<T>(
  endpoint: string,
  transformResponse?: (data: any) => T[]
) {
  return async (cursor: string | undefined, limit: number): Promise<FetchItemsResponse<T>> => {
    const params = new URLSearchParams();
    if (cursor) params.set('cursor', cursor);
    params.set('limit', limit.toString());

    const url = `${endpoint}?${params.toString()}`;
    const response = await fetch(url);
    
    if (!response.ok) {
      throw new Error('Failed to fetch items');
    }

    const data = await response.json();
    return {
      data: transformResponse ? transformResponse(data) : data.data,
      pagination: data.pagination || {
        nextCursor: undefined,
        prevCursor: undefined,
        hasMore: false,
        matchingItemsCount: 0
      }
    };
  };
} 