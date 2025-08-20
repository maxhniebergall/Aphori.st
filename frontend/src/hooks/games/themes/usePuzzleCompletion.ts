import { useState, useEffect, useCallback } from 'react';

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
}

const STORAGE_KEY_PREFIX = 'themes_puzzle_completion_';

export const usePuzzleCompletion = (
  setName: string, 
  version: string, 
  totalPuzzles: number = 100
): UsePuzzleCompletionReturn => {
  const [completionData, setCompletionData] = useState<PuzzleCompletionData>({
    setName,
    version,
    completedPuzzles: new Set(),
    completionDate: {}
  });

  const storageKey = `${STORAGE_KEY_PREFIX}${setName}_${version}`;

  // Load completion data from localStorage on mount or when set changes
  useEffect(() => {
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

  // Save completion data to localStorage whenever it changes
  useEffect(() => {
    try {
      const dataToStore = {
        completedPuzzles: Array.from(completionData.completedPuzzles),
        completionDate: completionData.completionDate
      };
      localStorage.setItem(storageKey, JSON.stringify(dataToStore));
    } catch (error) {
      console.error('Failed to save puzzle completion data:', error);
    }
  }, [completionData, storageKey]);

  const markPuzzleCompleted = useCallback((puzzleNumber: number) => {
    setCompletionData(prev => {
      const newCompleted = new Set(prev.completedPuzzles);
      const newCompletionDate = { ...prev.completionDate };
      
      if (!newCompleted.has(puzzleNumber)) {
        newCompleted.add(puzzleNumber);
        newCompletionDate[puzzleNumber] = new Date().toISOString();
      }

      return {
        ...prev,
        completedPuzzles: newCompleted,
        completionDate: newCompletionDate
      };
    });
  }, []);

  const isPuzzleCompleted = useCallback((puzzleNumber: number): boolean => {
    return completionData.completedPuzzles.has(puzzleNumber);
  }, [completionData.completedPuzzles]);

  const getCompletionDate = useCallback((puzzleNumber: number): string | null => {
    return completionData.completionDate[puzzleNumber] || null;
  }, [completionData.completionDate]);

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
    clearCompletions
  };
};