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
  DAILY_PUZZLES: (date: string) => `dailyPuzzles/themes/${date}`,
  PUZZLE: (date: string, puzzleId: string) => `dailyPuzzles/themes/${date}/${puzzleId}`,
  
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
} as const;

// Quality control interfaces
export interface WordQualityMetrics {
  appropriateness: number; // 0-1, content appropriateness
  commonality: number; // 0-1, how well-known the word is
  difficulty: number; // 1-10, estimated difficulty
  semanticClarity: number; // 0-1, how clear the meaning is
  overallScore: number; // 0-1, weighted combination
}

export interface CategoryQualityMetrics {
  internalCohesion: number; // 0-1, similarity within category
  semanticClarity: number; // 0-1, how clear the theme is
  wordQuality: number; // 0-1, average word quality
  appropriateness: number; // 0-1, content appropriateness
  difficulty: number; // 1-10, category difficulty
  overallScore: number; // 0-1, weighted combination
}

export interface PuzzleQualityMetrics {
  categoryQuality: number; // 0-1, average category quality
  crossCategoryDiversity: number; // 0-1, how distinct categories are
  difficultyProgression: number; // 0-1, how well difficulty scales
  wordDiversity: number; // 0-1, lexical diversity
  appropriateness: number; // 0-1, overall content appropriateness
  overallScore: number; // 0-1, weighted combination
}

export interface QualityControlConfig {
  // Word validation thresholds
  minWordAppropriateness: number;
  minWordCommonality: number;
  maxWordDifficulty: number;
  minWordSemanticClarity: number;
  minWordOverallScore: number;
  
  // Category validation thresholds
  minCategoryInternalCohesion: number;
  minCategorySemanticClarity: number;
  minCategoryWordQuality: number;
  minCategoryAppropriateness: number;
  maxCategoryDifficulty: number;
  minCategoryOverallScore: number;
  
  // Puzzle validation thresholds
  minPuzzleCategoryQuality: number;
  minCrossCategoryDiversity: number;
  minDifficultyProgression: number;
  minWordDiversity: number;
  minPuzzleAppropriateness: number;
  minPuzzleOverallScore: number;
  
  // Cross-category validation
  maxCategorySimilarity: number;
  minCategoryDistance: number;
  
  // Content filtering
  excludedWords: string[];
  excludedTopics: string[];
  requiredWordTypes: string[];
}

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

// Quality control configuration
export const QUALITY_CONTROL_CONFIG: QualityControlConfig = {
  // Word validation thresholds
  minWordAppropriateness: 0.8,
  minWordCommonality: 0.3,
  maxWordDifficulty: 8,
  minWordSemanticClarity: 0.6,
  minWordOverallScore: 0.6,
  
  // Category validation thresholds
  minCategoryInternalCohesion: 0.4,
  minCategorySemanticClarity: 0.5,
  minCategoryWordQuality: 0.6,
  minCategoryAppropriateness: 0.9,
  maxCategoryDifficulty: 8,
  minCategoryOverallScore: 0.6,
  
  // Puzzle validation thresholds
  minPuzzleCategoryQuality: 0.6,
  minCrossCategoryDiversity: 0.3,
  minDifficultyProgression: 0.5,
  minWordDiversity: 0.4,
  minPuzzleAppropriateness: 0.9,
  minPuzzleOverallScore: 0.6,
  
  // Cross-category validation
  maxCategorySimilarity: 0.6,
  minCategoryDistance: 0.3,
  
  // Content filtering
  excludedWords: [
    // Inappropriate content
    'xxx', 'sex', 'porn', 'nude', 'naked', 'drug', 'drugs', 'cocaine', 'heroin', 'marijuana',
    'kill', 'murder', 'death', 'dead', 'suicide', 'hate', 'racist', 'nazi', 'hitler',
    'hell', 'damn', 'shit', 'fuck', 'bitch', 'ass', 'bastard',
    // Sensitive topics
    'religion', 'politics', 'war', 'bomb', 'gun', 'weapon', 'violence', 'blood',
    // Potentially confusing
    'a', 'an', 'the', 'and', 'or', 'but', 'if', 'of', 'to', 'in', 'on', 'at',
    // Too abstract
    'thing', 'stuff', 'item', 'object', 'concept', 'idea', 'notion'
  ],
  
  excludedTopics: [
    'violence', 'sexuality', 'drugs', 'politics', 'religion', 'death', 'profanity'
  ],
  
  requiredWordTypes: [
    'noun', 'adjective', 'verb' // Prefer concrete word types
  ]
};

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