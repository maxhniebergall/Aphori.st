import { useState, useEffect, useCallback } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useThemeCompletedPuzzles, themeGameKeys } from './queries';

export interface PuzzleCompletionData {
  setName: string;
  version: string;
  completedPuzzles: Set<number>;
  completionDate: Record<number, string>; // puzzleNumber -> ISO date string
}

export interface UsePuzzleCompletionReturn {
  completedPuzzles: Set<number>;
  markPuzzleCompleted: (puzzleNumber: number) => void;
  isPuzzleCompleted: (puzzleNumber: number) => boolean;
  getCompletionDate: (puzzleNumber: number) => string | null;
  getCompletionStats: () => { completed: number; total: number; percentage: number };
  clearCompletions: () => void;
  syncWithBackend: () => Promise<void>;
  isLoading: boolean;
}

const STORAGE_KEY_PREFIX = 'themes_puzzle_completion_';

export const usePuzzleCompletion = (
  setName: string, 
  version: string, 
  totalPuzzles: number = 100
): UsePuzzleCompletionReturn => {
  const queryClient = useQueryClient();
  const [completionData, setCompletionData] = useState<PuzzleCompletionData>({
    setName,
    version,
    completedPuzzles: new Set(),
    completionDate: {}
  });
  const [hasSyncedOnMount, setHasSyncedOnMount] = useState(false);

  // Use TanStack Query for backend data
  const { 
    data: backendCompletedPuzzles, 
    isLoading, 
    refetch: refetchCompletedPuzzles 
  } = useThemeCompletedPuzzles(setName, !!setName);

  const storageKey = `${STORAGE_KEY_PREFIX}${setName}_${version}`;

  // Load completion data from localStorage on mount or when set changes
  useEffect(() => {
    setHasSyncedOnMount(false); // Reset sync flag when set changes
    try {
      const stored = localStorage.getItem(storageKey);
      if (stored) {
        const parsed = JSON.parse(stored);
        setCompletionData({
          setName,
          version,
          completedPuzzles: new Set(parsed.completedPuzzles || []),
          completionDate: parsed.completionDate || {}
        });
      } else {
        // Initialize new completion data for this set
        setCompletionData({
          setName,
          version,
          completedPuzzles: new Set(),
          completionDate: {}
        });
      }
    } catch (error) {
      console.error('Failed to load puzzle completion data:', error);
      setCompletionData({
        setName,
        version,
        completedPuzzles: new Set(),
        completionDate: {}
      });
    }
  }, [setName, version, storageKey]);

  // Merge backend data with local data when backend data becomes available
  useEffect(() => {
    if (backendCompletedPuzzles && !hasSyncedOnMount) {
      const backendCompletedPuzzlesSet = new Set<number>(backendCompletedPuzzles);
      
      setCompletionData(prev => {
        // Merge backend data with local data
        const mergedCompletions = new Set([
          ...prev.completedPuzzles,
          ...backendCompletedPuzzlesSet
        ]);
        
        // Add completion dates for backend puzzles (using current date if not available)
        const mergedDates = { ...prev.completionDate };
        backendCompletedPuzzlesSet.forEach(puzzleNum => {
          if (!mergedDates[puzzleNum]) {
            mergedDates[puzzleNum] = new Date().toISOString();
          }
        });
        
        return {
          ...prev,
          completedPuzzles: mergedCompletions,
          completionDate: mergedDates
        };
      });
      
      setHasSyncedOnMount(true);
    }
  }, [backendCompletedPuzzles, hasSyncedOnMount]);

  // Save completion data to localStorage whenever it changes (only after initial sync)
  useEffect(() => {
    // Only save to localStorage after we've synced with backend on mount
    if (hasSyncedOnMount) {
      try {
        const dataToStore = {
          completedPuzzles: Array.from(completionData.completedPuzzles),
          completionDate: completionData.completionDate
        };
        localStorage.setItem(storageKey, JSON.stringify(dataToStore));
      } catch (error) {
        console.error('Failed to save puzzle completion data:', error);
      }
    }
  }, [completionData, storageKey, hasSyncedOnMount]);

  // Sync completion data with backend using TanStack Query refetch
  const syncWithBackend = useCallback(async () => {
    if (!setName) return;
    
    try {
      await refetchCompletedPuzzles();
    } catch (error) {
      console.error('Failed to sync with backend:', error);
      // Continue with local data on error
    }
  }, [setName, refetchCompletedPuzzles]);

  const markPuzzleCompleted = useCallback((puzzleNumber: number) => {
    setCompletionData(prev => {
      const newCompleted = new Set(prev.completedPuzzles);
      const newCompletionDate = { ...prev.completionDate };
      
      if (!newCompleted.has(puzzleNumber)) {
        newCompleted.add(puzzleNumber);
        newCompletionDate[puzzleNumber] = new Date().toISOString();
        
        // Note: The backend completion tracking is handled via the attempt submission
        // This just updates the local state immediately for responsive UI
      }

      return {
        ...prev,
        completedPuzzles: newCompleted,
        completionDate: newCompletionDate
      };
    });
    
    // Invalidate the completed puzzles query to trigger a refetch
    // This will sync with backend after a short delay to confirm completion
    setTimeout(() => {
      queryClient.invalidateQueries({ 
        queryKey: themeGameKeys.completedPuzzles(setName) 
      });
    }, 1000);
  }, [queryClient, setName]);

  const isPuzzleCompleted = useCallback((puzzleNumber: number): boolean => {
    return completionData.completedPuzzles.has(puzzleNumber);
  }, [completionData.completedPuzzles]);

  const getCompletionDate = useCallback((puzzleNumber: number): string | null => {
    return completionData.completedPuzzles.has(puzzleNumber) ? completionData.completionDate[puzzleNumber] || null : null;
  }, [completionData.completedPuzzles, completionData.completionDate]);

  const getCompletionStats = useCallback(() => {
    const completed = completionData.completedPuzzles.size;
    const percentage = totalPuzzles > 0 ? (completed / totalPuzzles) * 100 : 0;
    
    return {
      completed,
      total: totalPuzzles,
      percentage: Math.round(percentage * 100) / 100 // Round to 2 decimal places
    };
  }, [completionData.completedPuzzles, totalPuzzles]);

  const clearCompletions = useCallback(() => {
    setCompletionData(prev => ({
      ...prev,
      completedPuzzles: new Set(),
      completionDate: {}
    }));
  }, []);

  return {
    completedPuzzles: completionData.completedPuzzles,
    markPuzzleCompleted,
    isPuzzleCompleted,
    getCompletionDate,
    getCompletionStats,
    clearCompletions,
    syncWithBackend,
    isLoading
  };
};