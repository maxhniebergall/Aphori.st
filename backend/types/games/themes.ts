/**
 * Types for Themes Game - Connections-style word puzzle game
 */

export interface ThemesPuzzle {
  id: string;
  date: string; // YYYY-MM-DD format
  gridSize: number; // 4 for 4x4, 5 for 5x5, etc.
  puzzleNumber: number; // 1-7 for daily progression
  words: string[];
  categories: ThemesCategory[];
  difficulty: number; // 1-10 scale
  createdAt: number; // timestamp
}

export interface ThemesCategory {
  themeWord: string; // The central word that defines this category
  words: string[]; // All words in this category (including themeWord)
  similarity: number; // Average similarity score within category
}

export interface ThemesGameState {
  userId: string; // Could be permanent user ID or temporary user ID
  userType: 'logged_in' | 'temporary';
  currentDate: string; // YYYY-MM-DD
  completedPuzzles: string[]; // Array of completed puzzle IDs
  currentPuzzleIndex: number; // 0-6 for daily progression
  totalAttempts: number;
  lastAccessed: number; // timestamp
}

export interface ThemesAttempt {
  id: string;
  userId: string;
  userType: 'logged_in' | 'temporary';
  puzzleId: string;
  selectedWords: string[];
  selectionOrder: number[]; // Order in which words were selected (indices into selectedWords)
  result: 'correct' | 'incorrect';
  distance: number; // How many words away from correct (0 = correct)
  timestamp: number;
  completedPuzzle: boolean; // True if this attempt completed the puzzle
}

export interface ThemesShareable {
  userId: string;
  date: string; // YYYY-MM-DD
  puzzles: ThemesShareablePuzzle[];
  totalAttempts: number;
  allCompleted: boolean;
  generatedAt: number; // timestamp
}

export interface ThemesShareablePuzzle {
  puzzleNumber: number; // 1-7
  gridSize: number;
  attempts: number;
  completed: boolean;
  emojiPattern: string[]; // Array of emoji strings representing attempts
}

export interface TemporaryUserId {
  tempId: string;
  createdAt: number;
  lastAccessed: number;
  expiresAt: number; // 60 days from creation
  fingerprint?: UserFingerprint; // Browser fingerprinting data
}

// Analytics interfaces
export interface ThemesPuzzleView {
  id: string;
  userId: string;
  userType: 'logged_in' | 'temporary';
  puzzleId: string;
  setName: string;
  puzzleNumber: number;
  timestamp: number;
  ipAddress: string;
  userAgent: string;
  fingerprint?: UserFingerprint;
}

export interface UserFingerprint {
  screenResolution: string;
  timezone: string;
  language: string;
  platform: string;
  cookieEnabled: boolean;
  doNotTrack: boolean;
}

export interface ThemesPuzzleFeedback {
  id: string;
  userId: string;
  userType: 'logged_in' | 'temporary';
  puzzleId: string;
  setName: string;
  puzzleNumber: number;
  rating: number; // 1-5 stars
  comment: string;
  timestamp: number;
}

export interface ThemesPuzzleCompletion {
  id: string;
  userId: string;
  userType: 'logged_in' | 'temporary';
  puzzleId: string;
  setName: string;
  puzzleNumber: number;
  totalAttempts: number;
  completionTime: number; // Time from first view to completion in milliseconds
  categoryCompletionOrder: string[]; // Order categories were solved
  averageWordsPerAttempt: number;
  uniqueWordSelections: number; // Total unique words selected across all attempts
  timestamp: number;
}

// Vector-related types for themes system
export interface ThemesVectorEntry {
  word: string;
  vector: number[];
  metadata: {
    frequency?: number;
    difficulty?: number;
    categories?: string[];
  };
}

export interface ThemesVectorIndexMetadata {
  totalWords: number;
  dimension: number;
  shards: Record<string, ThemesVectorShard>;
  lastUpdated: number;
  version: string;
}

export interface ThemesVectorShard {
  id: string;
  wordCount: number;
  createdAt: number;
}

// Database path configuration
export const THEMES_DB_PATHS = {
  // Daily puzzles
  DAILY_PUZZLES: (date: string) => `games/themes/daily/${date}`,
  PUZZLE: (date: string, puzzleId: string) => `games/themes/daily/${date}/${puzzleId}`,
  
  // User progress
  USER_PROGRESS: (userId: string) => `userGameState/themes/${userId}`,
  TEMP_USER_PROGRESS: (tempUserId: string) => `tempUserGameState/themes/${tempUserId}`,
  
  // Attempts (permanent storage)
  USER_ATTEMPTS: (userId: string, date: string) => `gameAttempts/themes/${userId}/${date}`,
  ATTEMPT: (userId: string, date: string, attemptId: string) => `gameAttempts/themes/${userId}/${date}/${attemptId}`,
  
  // Temporary users
  TEMP_USERS: 'tempUsers',
  TEMP_USER: (tempUserId: string) => `tempUsers/${tempUserId}`,
  
  // Vector index (separate from main Aphorist vectors)
  THEMES_VECTOR_INDEX: 'themesVectorIndex',
  THEMES_VECTOR_METADATA: 'themesVectorIndex/metadata',
  THEMES_VECTOR_SHARD: (shardId: string) => `themesVectorIndex/shards/${shardId}`,
  
  // Word dataset
  WORD_DATASET: 'themesWordDataset',
  WORD_DATASET_METADATA: 'themesWordDataset/metadata',
  
  // Analytics paths
  PUZZLE_VIEWS: 'analytics/puzzleViews',
  PUZZLE_VIEW: (viewId: string) => `analytics/puzzleViews/${viewId}`,
  USER_PUZZLE_VIEWS: (userId: string) => `analytics/userPuzzleViews/${userId}`,
  PUZZLE_FEEDBACK: 'analytics/puzzleFeedback',
  FEEDBACK_ENTRY: (feedbackId: string) => `analytics/puzzleFeedback/${feedbackId}`,
  USER_FEEDBACK: (userId: string) => `analytics/userFeedback/${userId}`,
  PUZZLE_COMPLETIONS: 'analytics/puzzleCompletions',
  COMPLETION_ENTRY: (completionId: string) => `analytics/puzzleCompletions/${completionId}`,
  USER_COMPLETIONS: (userId: string) => `analytics/userCompletions/${userId}`,
} as const;

// Configuration constants
export const THEMES_CONFIG = {
  PUZZLE_SIZES: [4, 5, 6, 7, 8, 9, 10] as const,
  DAILY_PUZZLE_COUNT: 7,
  TEMP_USER_EXPIRY_DAYS: 60,
  MAX_ATTEMPTS_PER_PUZZLE: 10,
  MIN_CATEGORY_SIMILARITY: 0.7,
  MAX_CROSS_CATEGORY_SIMILARITY: 0.4,
  VECTOR_DIMENSION: 300, // Matches binary theme index dimension
} as const;

// Type guards
export function isTemporaryUserId(userId: string): boolean {
  return userId.startsWith('temp_');
}

export function isValidPuzzleSize(size: number): size is typeof THEMES_CONFIG.PUZZLE_SIZES[number] {
  return THEMES_CONFIG.PUZZLE_SIZES.includes(size as any);
}

export function isValidDate(dateString: string): boolean {
  const regex = /^\d{4}-\d{2}-\d{2}$/;
  if (!regex.test(dateString)) return false;
  
  const date = new Date(dateString);
  return date.toISOString().slice(0, 10) === dateString;
}