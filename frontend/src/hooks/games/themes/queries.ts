/**
 * TanStack Query hooks for themes game GET requests
 */

import { useQuery } from '@tanstack/react-query';
import { ThemesPuzzle, ThemeCategory } from './useThemesGame';
import { PuzzleSet, PuzzleSetVersion } from '../../../components/games/themes/PuzzleSetSelector';
import { ShareableResults } from './useShareableResults';

const baseURL = process.env.REACT_APP_API_URL || 'http://localhost:5050';

// Exponential backoff retry function
const retryWithBackoff = (failureCount: number, error: Error) => {
  // Check if error is rate limit related
  const isRateLimit = error.message.includes('rate limit') || 
                     error.message.includes('429') ||
                     (error as any).status === 429;
  
  // Check if error is server error (5xx)
  const isServerError = error.message.includes('500') ||
                       error.message.includes('502') ||
                       error.message.includes('503') ||
                       error.message.includes('504') ||
                       (error as any).status >= 500;
  
  // Only retry on rate limits and server errors
  if (!isRateLimit && !isServerError) {
    return false;
  }
  
  // Max 5 retries
  if (failureCount >= 5) {
    return false;
  }
  
  return true;
};

const retryDelay = (attemptIndex: number) => {
  // Exponential backoff: 1s, 2s, 4s, 8s, 16s
  const baseDelay = 1000;
  const backoffMultiplier = Math.pow(2, attemptIndex);
  const jitter = Math.random() * 0.1; // Add 10% jitter to prevent thundering herd
  
  return baseDelay * backoffMultiplier * (1 + jitter);
};

// Response types for API calls
interface ApiResponse<T> {
  success: boolean;
  data: T;
  error?: string;
}

interface PuzzleSetsResponse {
  sets: PuzzleSet[];
}

interface PuzzlesResponse {
  puzzles: ThemesPuzzle[];
}

interface SinglePuzzleResponse {
  puzzle: ThemesPuzzle;
}

interface AttemptsResponse {
  attempts: any[];
}

interface CompletedPuzzlesResponse {
  completedPuzzles: number[];
}

// Query key factories
export const themeGameKeys = {
  all: ['themeGame'] as const,
  sets: () => [...themeGameKeys.all, 'sets'] as const,
  puzzles: (setName: string, version: string) => [...themeGameKeys.all, 'puzzles', setName, version] as const,
  puzzle: (setName: string, version: string, puzzleNumber: number) => [...themeGameKeys.all, 'puzzle', setName, version, puzzleNumber] as const,
  attempts: (puzzleId: string) => [...themeGameKeys.all, 'attempts', puzzleId] as const,
  completedPuzzles: (setName: string) => [...themeGameKeys.all, 'completedPuzzles', setName] as const,
  shareable: (setName: string, puzzleNumber: number) => [...themeGameKeys.all, 'shareable', setName, puzzleNumber] as const,
};

/**
 * Get all available puzzle sets
 */
export const useThemeSets = () => {
  return useQuery({
    queryKey: themeGameKeys.sets(),
    queryFn: async (): Promise<PuzzleSet[]> => {
      const response = await fetch(`${baseURL}/api/games/themes/sets`, {
        credentials: 'include'
      });
      
      if (!response.ok) {
        throw new Error('Failed to fetch puzzle sets');
      }
      
      const data: ApiResponse<PuzzleSetsResponse> = await response.json();
      
      if (!data.success) {
        throw new Error(data.error || 'Failed to load puzzle sets');
      }
      
      return data.data.sets;
    },
    staleTime: 5 * 60 * 1000, // 5 minutes
    gcTime: 10 * 60 * 1000, // 10 minutes
    retry: retryWithBackoff,
    retryDelay,
  });
};

/**
 * Get all puzzles in a specific set and version
 */
export const useThemePuzzlesInSet = (setName: string, version: string, enabled = true) => {
  return useQuery({
    queryKey: themeGameKeys.puzzles(setName, version),
    queryFn: async ({ signal }): Promise<ThemesPuzzle[]> => {
      const response = await fetch(`${baseURL}/api/games/themes/sets/${encodeURIComponent(setName)}/${encodeURIComponent(version)}`, {
        credentials: 'include',
        signal
      });
      
      if (!response.ok) {
        throw new Error('Failed to fetch puzzles in set');
      }
      
      const data: ApiResponse<PuzzlesResponse> = await response.json();
      
      if (!data.success) {
        throw new Error(data.error || 'Failed to load puzzles');
      }
      
      return data.data.puzzles;
    },
    enabled,
    staleTime: 5 * 60 * 1000, // 5 minutes
    gcTime: 10 * 60 * 1000, // 10 minutes
    retry: retryWithBackoff,
    retryDelay,
  });
};

/**
 * Get a single puzzle by set, version, and puzzle number
 */
export const useThemePuzzle = (setName: string, version: string, puzzleNumber: number, enabled = true) => {
  return useQuery({
    queryKey: themeGameKeys.puzzle(setName, version, puzzleNumber),
    queryFn: async ({ signal }): Promise<ThemesPuzzle> => {
      const response = await fetch(`${baseURL}/api/games/themes/sets/${encodeURIComponent(setName)}/${encodeURIComponent(version)}/puzzle/${encodeURIComponent(String(puzzleNumber))}`, {
        credentials: 'include',
        signal
      });
      
      if (!response.ok) {
        throw new Error('Failed to fetch puzzle');
      }
      
      const data: ApiResponse<SinglePuzzleResponse> = await response.json();
      
      if (!data.success) {
        throw new Error(data.error || 'Failed to load puzzle');
      }
      
      return data.data.puzzle;
    },
    enabled,
    staleTime: Infinity, // Permanent during session
    gcTime: Infinity, // Keep in cache permanently during session
    retry: retryWithBackoff,
    retryDelay,
  });
};

/**
 * Get puzzle attempts for a specific puzzle
 */
export const useThemeAttempts = (puzzleId: string, enabled = true) => {
  return useQuery({
    queryKey: themeGameKeys.attempts(puzzleId),
    queryFn: async ({ signal }): Promise<any[]> => {
      const response = await fetch(`${baseURL}/api/games/themes/state/attempts/${encodeURIComponent(puzzleId)}`, {
        credentials: 'include',
        signal
      });
      
      if (!response.ok) {
        throw new Error('Failed to fetch puzzle attempts');
      }
      
      const data: ApiResponse<AttemptsResponse> = await response.json();
      
      if (!data.success) {
        throw new Error(data.error || 'Failed to load attempts');
      }
      
      return data.data.attempts;
    },
    enabled,
    staleTime: 1 * 60 * 1000, // 1 minute (short cache for frequently changing data)
    gcTime: 5 * 60 * 1000, // 5 minutes
    retry: retryWithBackoff,
    retryDelay,
  });
};

/**
 * Get completed puzzles for a specific set
 */
export const useThemeCompletedPuzzles = (setName: string, enabled = true) => {
  return useQuery({
    queryKey: themeGameKeys.completedPuzzles(setName),
    queryFn: async ({ signal }): Promise<number[]> => {
      const response = await fetch(`${baseURL}/api/games/themes/state/completed-puzzles/${encodeURIComponent(setName)}`, {
        credentials: 'include',
        signal
      });
      
      if (!response.ok) {
        throw new Error('Failed to fetch completed puzzles');
      }
      
      const data: ApiResponse<CompletedPuzzlesResponse> = await response.json();
      
      if (!data.success) {
        throw new Error(data.error || 'Failed to load completed puzzles');
      }
      
      return data.data.completedPuzzles;
    },
    enabled,
    staleTime: 2 * 60 * 1000, // 2 minutes
    gcTime: 10 * 60 * 1000, // 10 minutes
    retry: retryWithBackoff,
    retryDelay,
  });
};

/**
 * Get shareable results for a specific puzzle
 */
export const useThemeShareableResults = (setName: string, puzzleNumber: number, enabled = true) => {
  return useQuery({
    queryKey: themeGameKeys.shareable(setName, puzzleNumber),
    queryFn: async ({ signal }): Promise<ShareableResults> => {
      const response = await fetch(`${baseURL}/api/games/themes/state/shareable/${encodeURIComponent(setName)}/${encodeURIComponent(String(puzzleNumber))}`, {
        credentials: 'include',
        signal
      });
      
      if (!response.ok) {
        throw new Error('Failed to fetch shareable results');
      }
      
      const data: ApiResponse<ShareableResults> = await response.json();
      
      if (!data.success) {
        throw new Error(data.error || 'Failed to load shareable results');
      }
      
      return data.data;
    },
    enabled,
    staleTime: 2 * 60 * 1000, // 2 minutes
    gcTime: 10 * 60 * 1000, // 10 minutes
    retry: retryWithBackoff,
    retryDelay,
  });
};