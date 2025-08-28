import { useState, useCallback, useRef, useEffect } from 'react';
import { GridWord } from '../../../components/games/themes/GameGrid';
import { useThemePuzzle, useThemeAttempts } from './queries';
import { useSubmitAttempt } from './mutations';

export interface ThemesPuzzle {
  id: string;
  setName: string;
  puzzleNumber: number;
  gridSize: number;
  difficulty: number;
  categories: ThemeCategory[];
  words: string[];
  createdAt?: number;
  metadata?: {
    avgSimilarity: number;
    qualityScore: number;
    generatedBy: string;
    algorithm?: string;
    batchGenerated?: boolean;
  };
}

export interface ThemeCategory {
  id: string;
  themeWord: string;
  words: string[];
  difficulty: number;
  similarity: number;
}

export interface GameState {
  selectedWords: string[];
  selectionOrder: number[]; // Order in which words were selected
  completedCategories: string[];
  attempts: number;
  isComplete: boolean;
  shakingWords: string[];
  gridWords: GridWord[];
  animatingWords: string[];
}

export interface UseThemesGameReturn {
  gameState: GameState;
  puzzle: ThemesPuzzle | null;
  loading: boolean;
  error: string | null;
  selectWord: (word: string) => void;
  submitSelection: () => Promise<void>;
  randomizeGrid: () => void;
  loadPuzzleFromSet: (setName: string, version: string, puzzleNumber: number) => Promise<void>;
  resetGame: () => void;
}

const WORDS_PER_CATEGORY = 4;
const MAX_ATTEMPTS = 4;

export const useThemesGame = (): UseThemesGameReturn => {
  // State for tracking current puzzle parameters to enable/disable queries
  const [currentPuzzleParams, setCurrentPuzzleParams] = useState<{
    setName: string;
    version: string;
    puzzleNumber: number;
  } | null>(null);
  
  const [error, setError] = useState<string | null>(null);
  const shakeTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const animationTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const submissionInProgressRef = useRef<boolean>(false);
  const lastSubmissionTimeRef = useRef<number>(0);
  
  const [gameState, setGameState] = useState<GameState>({
    selectedWords: [],
    selectionOrder: [],
    completedCategories: [],
    attempts: 0,
    isComplete: false,
    shakingWords: [],
    gridWords: [],
    animatingWords: []
  });

  // TanStack Query hooks
  const puzzleQuery = useThemePuzzle(
    currentPuzzleParams?.setName || '',
    currentPuzzleParams?.version || '',
    currentPuzzleParams?.puzzleNumber || 0,
    !!currentPuzzleParams
  );

  const puzzleId = currentPuzzleParams 
    ? `${currentPuzzleParams.setName}_${currentPuzzleParams.puzzleNumber}` 
    : '';
    
  const attemptsQuery = useThemeAttempts(
    puzzleId,
    !!currentPuzzleParams
  );

  const submitAttemptMutation = useSubmitAttempt();

  // Derived state from queries
  const puzzle = puzzleQuery.data || null;
  const loading = puzzleQuery.isLoading || attemptsQuery.isLoading || submitAttemptMutation.isPending;
  const queryError = puzzleQuery.error || attemptsQuery.error || submitAttemptMutation.error;

  // Update error state from queries
  useEffect(() => {
    if (queryError) {
      setError(queryError instanceof Error ? queryError.message : 'Unknown error');
    } else {
      setError(null);
    }
  }, [queryError]);

  // Shuffle array utility
  const shuffleArray = useCallback(<T,>(array: T[]): T[] => {
    const shuffled = [...array];
    for (let i = shuffled.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
    }
    return shuffled;
  }, []);

  // Initialize grid words from puzzle
  const initializeGridWords = useCallback((puzzle: ThemesPuzzle, completedCategories: string[] = []): GridWord[] => {
    const gridWords: GridWord[] = puzzle.words.map((word, index) => {
      // Use case-insensitive matching for category finding
      const category = puzzle.categories.find(cat => 
        cat.words.some(catWord => catWord.toLowerCase().trim() === word.toLowerCase().trim())
      );
      const isCompleted = category ? completedCategories.includes(category.id) : false;
      
      if (category) {
        console.log(`[ThemesGame] Initializing word "${word}" in category: ${category.themeWord}, difficulty: ${category.difficulty}, isCompleted: ${isCompleted}`);
      }
      
      return {
        word,
        id: `word-${index}`,
        categoryId: category?.id,
        isCompleted,
        difficulty: isCompleted ? (category?.difficulty as 1 | 2 | 3 | 4) : undefined
      };
    });
    return shuffleArray(gridWords);
  }, [shuffleArray]);

  // Reconstruct game state when puzzle and attempts data are loaded
  useEffect(() => {
    if (puzzle && attemptsQuery.data && !attemptsQuery.isLoading) {
      const attempts = attemptsQuery.data;
      
      if (attempts.length > 0) {
        // Find completed categories from correct attempts
        const completedCategories: string[] = [];
        for (const attempt of attempts) {
          if (attempt.result === 'correct') {
            // Find which category this attempt solved
            const solvedCategory = puzzle.categories.find((cat: ThemeCategory) => {
              const categoryWordSet = new Set(cat.words.map((w: string) => w.toLowerCase().trim()));
              const selectedWordSet = new Set(attempt.selectedWords.map((w: string) => w.toLowerCase().trim()));
              return categoryWordSet.size === selectedWordSet.size && 
                     Array.from(categoryWordSet).every(word => selectedWordSet.has(word));
            });
            if (solvedCategory && !completedCategories.includes(solvedCategory.id)) {
              completedCategories.push(solvedCategory.id);
            }
          }
        }

        // Check if puzzle is complete
        const isComplete = completedCategories.length >= puzzle.categories.length;
        
        // Count only incorrect attempts for the attempts counter
        interface AttemptResult {
          result: 'correct' | 'incorrect';
          selectedWords: string[];
        }
        const incorrectAttempts = attempts.filter((attempt: AttemptResult) => attempt.result === 'incorrect').length;
        
        setGameState({
          selectedWords: [],
          selectionOrder: [],
          completedCategories,
          attempts: incorrectAttempts,
          isComplete,
          shakingWords: [],
          gridWords: initializeGridWords(puzzle, completedCategories),
          animatingWords: []
        });
      } else {
        // No previous attempts, start fresh
        setGameState({
          selectedWords: [],
          selectionOrder: [],
          completedCategories: [],
          attempts: 0,
          isComplete: false,
          shakingWords: [],
          gridWords: initializeGridWords(puzzle),
          animatingWords: []
        });
      }
    }
  }, [puzzle, attemptsQuery.data, attemptsQuery.isLoading, initializeGridWords]);

  // Cleanup timeouts on unmount
  useEffect(() => {
    return () => {
      if (shakeTimeoutRef.current) {
        clearTimeout(shakeTimeoutRef.current);
      }
      if (animationTimeoutRef.current) {
        clearTimeout(animationTimeoutRef.current);
      }
    };
  }, []);

  // Load puzzle from a specific set
  const loadPuzzleFromSet = useCallback(async (setName: string, version: string, puzzleNumber: number) => {
    // Clear any existing error
    setError(null);
    
    // Set the puzzle parameters to trigger the queries
    setCurrentPuzzleParams({ setName, version, puzzleNumber });
  }, []);

  // Select/deselect word
  const selectWord = useCallback((word: string) => {
    setGameState(prev => {
      const isSelected = prev.selectedWords.includes(word);
      let newSelected: string[];
      let newSelectionOrder: number[];

      if (isSelected) {
        // Deselect word - remove from both arrays
        const wordIndex = prev.selectedWords.indexOf(word);
        newSelected = prev.selectedWords.filter(w => w !== word);
        newSelectionOrder = prev.selectionOrder.filter((_, i) => i !== wordIndex);
      } else {
        // Select word (up to WORDS_PER_CATEGORY)
        if (prev.selectedWords.length < WORDS_PER_CATEGORY) {
          newSelected = [...prev.selectedWords, word];
          newSelectionOrder = [...prev.selectionOrder, prev.selectionOrder.length];
        } else {
          // Replace oldest selected word
          newSelected = [...prev.selectedWords.slice(1), word];
          newSelectionOrder = [...prev.selectionOrder.slice(1).map(order => order - 1), prev.selectionOrder.length - 1];
        }
      }

      return {
        ...prev,
        selectedWords: newSelected,
        selectionOrder: newSelectionOrder,
        shakingWords: [] // Clear any shaking animation
      };
    });
  }, []);

  // Submit selection
  const submitSelection = useCallback(async () => {
    if (!puzzle || gameState.selectedWords.length !== WORDS_PER_CATEGORY) {
      return;
    }

    // Prevent concurrent submissions and rapid clicking
    const now = Date.now();
    if (submissionInProgressRef.current) {
      console.warn('Submission already in progress, ignoring duplicate request');
      return;
    }

    // Debounce rapid submissions (prevent clicks within 100ms)
    if (now - lastSubmissionTimeRef.current < 100) {
      console.warn('Rapid submission detected, ignoring duplicate request');
      return;
    }

    submissionInProgressRef.current = true;
    lastSubmissionTimeRef.current = now;

    // Capture current selected words to avoid stale closure issues
    const currentSelectedWords = gameState.selectedWords;
    const currentSelectionOrder = gameState.selectionOrder;

    try {
      const result = await submitAttemptMutation.mutateAsync({
        puzzleId: puzzle.id,
        selectedWords: currentSelectedWords,
        selectionOrder: currentSelectionOrder
      });

      setGameState(prev => {
        const newState = {
          ...prev
        };

        if (result.attempt.result === 'correct') {
          // Found a complete category - find which category was solved
          const correctCategory = puzzle.categories.find(cat => {
            const categoryWordSet = new Set(cat.words);
            const selectedWordSet = new Set(currentSelectedWords);
            return categoryWordSet.size === selectedWordSet.size && 
                   Array.from(categoryWordSet).every(word => selectedWordSet.has(word));
          });
          
          if (correctCategory && !prev.completedCategories.includes(correctCategory.id)) {
            console.log(`[ThemesGame] Completing category: ${correctCategory.themeWord} with words:`, correctCategory.words);
            
            newState.completedCategories = [...prev.completedCategories, correctCategory.id];
            
            // Start animation for completed category words
            newState.animatingWords = correctCategory.words;
            
            // Update gridWords to mark completed words - ensure atomic update with validation
            newState.gridWords = prev.gridWords.map(gridWord => {
              // Use case-insensitive matching to handle potential case differences
              const isWordInCategory = correctCategory.words.some(categoryWord => 
                categoryWord.toLowerCase().trim() === gridWord.word.toLowerCase().trim()
              );
              
              if (isWordInCategory) {
                console.log(`[ThemesGame] Marking word as completed: "${gridWord.word}" in category: ${correctCategory.themeWord}`);
                // Always ensure completed words maintain their state, even if already completed
                return {
                  ...gridWord,
                  isCompleted: true,
                  difficulty: correctCategory.difficulty as 1 | 2 | 3 | 4,
                  // Add a timestamp to help debug race conditions
                  completedAt: Date.now()
                };
              }
              return gridWord;
            });
            
            // Clear any existing animation timeout to prevent conflicts
            if (animationTimeoutRef.current) {
              clearTimeout(animationTimeoutRef.current);
            }
            
            // Use a more robust animation cleanup with state validation
            animationTimeoutRef.current = setTimeout(() => {
              setGameState(current => {
                // Validate that we should still clear these animations
                // Check if the category is still in completed categories
                if (!current.completedCategories.includes(correctCategory.id)) {
                  return current; // Don't clear if category was somehow removed
                }
                
                // Verify all words in this category are still marked as completed
                const allWordsStillCompleted = correctCategory.words.every(categoryWord => {
                  const gridWord = current.gridWords.find(gw => 
                    gw.word.toLowerCase().trim() === categoryWord.toLowerCase().trim()
                  );
                  return gridWord?.isCompleted === true;
                });
                
                if (!allWordsStillCompleted) {
                  console.warn('Some words lost completed state, preserving animation');
                  return current;
                }
                
                // Only clear animation for words from this specific category
                const remainingAnimatingWords = current.animatingWords.filter(animatingWord => 
                  !correctCategory.words.some(categoryWord => 
                    categoryWord.toLowerCase().trim() === animatingWord.toLowerCase().trim()
                  )
                );
                
                if (remainingAnimatingWords.length !== current.animatingWords.length) {
                  return {
                    ...current,
                    animatingWords: remainingAnimatingWords
                  };
                }
                return current;
              });
              animationTimeoutRef.current = null;
            }, 1000);
          }
          newState.selectedWords = [];
          newState.selectionOrder = [];
          
          // Check if game is complete
          if (newState.completedCategories.length === puzzle.categories.length) {
            newState.isComplete = true;
          }
        } else {
          // Incorrect selection - increment attempts and trigger shake animation
          newState.attempts = prev.attempts + 1;
          newState.shakingWords = currentSelectedWords;
          newState.selectedWords = [];
          newState.selectionOrder = [];
          
          // Clear any existing shake timeout
          if (shakeTimeoutRef.current) {
            clearTimeout(shakeTimeoutRef.current);
          }
          
          // Clear shake animation after delay
          shakeTimeoutRef.current = setTimeout(() => {
            setGameState(current => {
              // Only update shakingWords, preserve all other state
              if (current.shakingWords.length > 0) {
                return {
                  ...current,
                  shakingWords: []
                };
              }
              return current;
            });
            shakeTimeoutRef.current = null;
          }, 500);
        }

        return newState;
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to submit attempt');
    } finally {
      // Always reset submission flag, even if there's an error
      submissionInProgressRef.current = false;
    }
  }, [puzzle, gameState.selectedWords, gameState.selectionOrder, submitAttemptMutation]);

  // Randomize grid
  const randomizeGrid = useCallback(() => {
    if (!puzzle) return;

    setGameState(prev => ({
      ...prev,
      gridWords: shuffleArray(prev.gridWords),
      selectedWords: [], // Clear selection on shuffle
      selectionOrder: [], // Clear selection order on shuffle
      shakingWords: [] // Clear any shaking animation
    }));
  }, [puzzle, shuffleArray]);

  // Reset game
  const resetGame = useCallback(() => {
    if (!puzzle) return;

    setGameState({
      selectedWords: [],
      selectionOrder: [],
      completedCategories: [],
      attempts: 0,
      isComplete: false,
      shakingWords: [],
      gridWords: initializeGridWords(puzzle),
      animatingWords: []
    });
  }, [puzzle, initializeGridWords]);

  return {
    gameState,
    puzzle,
    loading,
    error,
    selectWord,
    submitSelection,
    randomizeGrid,
    loadPuzzleFromSet,
    resetGame
  };
};