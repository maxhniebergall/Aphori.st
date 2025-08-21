import { useState, useCallback, useRef, useEffect } from 'react';
import { GridWord } from '../../../components/games/themes/GameGrid';

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
  loadPuzzle: (date: string, puzzleNumber: number) => Promise<void>;
  loadPuzzleFromSet: (setName: string, version: string, puzzleNumber: number) => Promise<void>;
  resetGame: () => void;
}

const WORDS_PER_CATEGORY = 4;
const MAX_ATTEMPTS = 4;

export const useThemesGame = (): UseThemesGameReturn => {
  const [puzzle, setPuzzle] = useState<ThemesPuzzle | null>(null);
  const [loading, setLoading] = useState<boolean>(false);
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
      const category = puzzle.categories.find(cat => cat.words.includes(word));
      const isCompleted = category ? completedCategories.includes(category.id) : false;
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

  // Load puzzle from API
  const loadPuzzle = useCallback(async (date: string, puzzleNumber: number) => {
    setLoading(true);
    setError(null);

    try {
      const baseURL = process.env.REACT_APP_API_URL || 'http://localhost:5050';
      const response = await fetch(`${baseURL}/api/games/themes/daily`, {
        credentials: 'include'
      });
      const data = await response.json();

      if (!data.success) {
        throw new Error(data.error || 'Failed to load puzzle');
      }

      const puzzles = data.data.puzzles;
      const targetPuzzle = puzzles.find((p: ThemesPuzzle) => p.puzzleNumber === puzzleNumber);

      if (!targetPuzzle) {
        throw new Error(`Puzzle ${puzzleNumber} not found for date ${date}`);
      }

      setPuzzle(targetPuzzle);
      setGameState({
        selectedWords: [],
        selectionOrder: [],
        completedCategories: [],
        attempts: 0,
        isComplete: false,
        shakingWords: [],
        gridWords: initializeGridWords(targetPuzzle),
        animatingWords: []
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setLoading(false);
    }
  }, [initializeGridWords]);

  // Load puzzle from a specific set
  const loadPuzzleFromSet = useCallback(async (setName: string, version: string, puzzleNumber: number) => {
    setLoading(true);
    setError(null);

    try {
      const baseURL = process.env.REACT_APP_API_URL || 'http://localhost:5050';
      const response = await fetch(`${baseURL}/api/games/themes/sets/${setName}/${version}/puzzle/${puzzleNumber}`, {
        credentials: 'include'
      });
      const data = await response.json();

      if (!data.success) {
        throw new Error(data.error || 'Failed to load puzzle');
      }

      const targetPuzzle = data.data.puzzle;

      setPuzzle(targetPuzzle);
      setGameState({
        selectedWords: [],
        selectionOrder: [],
        completedCategories: [],
        attempts: 0,
        isComplete: false,
        shakingWords: [],
        gridWords: initializeGridWords(targetPuzzle),
        animatingWords: []
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setLoading(false);
    }
  }, [initializeGridWords]);

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
      const baseURL = process.env.REACT_APP_API_URL || 'http://localhost:5050';
      const response = await fetch(`${baseURL}/api/games/themes/state/attempt`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        credentials: 'include',
        body: JSON.stringify({
          puzzleId: puzzle.id,
          selectedWords: currentSelectedWords,
          selectionOrder: currentSelectionOrder
        })
      });

      const data = await response.json();

      if (!data.success) {
        throw new Error(data.error || 'Failed to submit attempt');
      }

      const result = data.data;

      setGameState(prev => {
        const newState = {
          ...prev,
          attempts: prev.attempts + 1
        };

        if (result.attempt.result === 'correct') {
          // Found a complete category - find which category was solved
          const correctCategory = puzzle.categories.find(cat => {
            const categoryWordSet = new Set(cat.words);
            const selectedWordSet = new Set(currentSelectedWords);
            return categoryWordSet.size === selectedWordSet.size && 
                   [...categoryWordSet].every(word => selectedWordSet.has(word));
          });
          
          if (correctCategory && !prev.completedCategories.includes(correctCategory.id)) {
            console.log(`[ThemesGame] Completing category: ${correctCategory.themeWord} with words:`, correctCategory.words);
            
            newState.completedCategories = [...prev.completedCategories, correctCategory.id];
            
            // Start animation for completed category words
            newState.animatingWords = correctCategory.words;
            
            // Update gridWords to mark completed words - ensure atomic update with validation
            newState.gridWords = prev.gridWords.map(gridWord => {
              if (correctCategory.words.includes(gridWord.word)) {
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
                const allWordsStillCompleted = correctCategory.words.every(word => {
                  const gridWord = current.gridWords.find(gw => gw.word === word);
                  return gridWord?.isCompleted === true;
                });
                
                if (!allWordsStillCompleted) {
                  console.warn('Some words lost completed state, preserving animation');
                  return current;
                }
                
                // Only clear animation for words from this specific category
                const remainingAnimatingWords = current.animatingWords.filter(
                  word => !correctCategory.words.includes(word)
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
          // Incorrect selection - trigger shake animation
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
  }, [puzzle, gameState.selectedWords, gameState.selectionOrder]);

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
    loadPuzzle,
    loadPuzzleFromSet,
    resetGame
  };
};