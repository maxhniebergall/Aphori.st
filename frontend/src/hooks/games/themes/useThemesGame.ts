import { useState, useCallback, useEffect } from 'react';
import { GridWord } from '../../../components/games/themes/GameGrid';

export interface ThemesPuzzle {
  id: string;
  date: string;
  puzzleNumber: number;
  gridSize: number;
  difficulty: number; // 1-10 scale
  categories: ThemeCategory[];
  words: string[];
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
  completedCategories: string[];
  attempts: number;
  isComplete: boolean;
  shakingWords: string[];
  gridWords: GridWord[];
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
  resetGame: () => void;
}

const WORDS_PER_CATEGORY = 4;
const MAX_ATTEMPTS = 4;

export const useThemesGame = (): UseThemesGameReturn => {
  const [puzzle, setPuzzle] = useState<ThemesPuzzle | null>(null);
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  
  const [gameState, setGameState] = useState<GameState>({
    selectedWords: [],
    completedCategories: [],
    attempts: 0,
    isComplete: false,
    shakingWords: [],
    gridWords: []
  });

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
  const initializeGridWords = useCallback((puzzle: ThemesPuzzle): GridWord[] => {
    const gridWords: GridWord[] = puzzle.words.map((word, index) => ({
      word,
      id: `word-${index}`,
      categoryId: puzzle.categories.find(cat => cat.words.includes(word))?.id
    }));
    return shuffleArray(gridWords);
  }, [shuffleArray]);

  // Load puzzle from API (only today's puzzles available)
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
        throw new Error(`Puzzle ${puzzleNumber} not found`);
      }

      setPuzzle(targetPuzzle);
      setGameState({
        selectedWords: [],
        completedCategories: [],
        attempts: 0,
        isComplete: false,
        shakingWords: [],
        gridWords: initializeGridWords(targetPuzzle)
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

      if (isSelected) {
        // Deselect word
        newSelected = prev.selectedWords.filter(w => w !== word);
      } else {
        // Select word (up to WORDS_PER_CATEGORY)
        if (prev.selectedWords.length < WORDS_PER_CATEGORY) {
          newSelected = [...prev.selectedWords, word];
        } else {
          // Replace oldest selected word
          newSelected = [...prev.selectedWords.slice(1), word];
        }
      }

      return {
        ...prev,
        selectedWords: newSelected,
        shakingWords: [] // Clear any shaking animation
      };
    });
  }, []);

  // Submit selection
  const submitSelection = useCallback(async () => {
    if (!puzzle || gameState.selectedWords.length !== WORDS_PER_CATEGORY) {
      return;
    }

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
          selectedWords: gameState.selectedWords
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
            const selectedWordSet = new Set(gameState.selectedWords);
            return categoryWordSet.size === selectedWordSet.size && 
                   [...categoryWordSet].every(word => selectedWordSet.has(word));
          });
          
          if (correctCategory && !prev.completedCategories.includes(correctCategory.id)) {
            newState.completedCategories = [...prev.completedCategories, correctCategory.id];
          }
          newState.selectedWords = [];
          
          // Check if game is complete
          if (newState.completedCategories.length === puzzle.categories.length) {
            newState.isComplete = true;
          }
        } else {
          // Incorrect selection - trigger shake animation
          newState.shakingWords = prev.selectedWords;
          newState.selectedWords = [];
          
          // Clear shake animation after delay
          setTimeout(() => {
            setGameState(current => ({
              ...current,
              shakingWords: []
            }));
          }, 500);
        }

        return newState;
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to submit attempt');
    }
  }, [puzzle, gameState.selectedWords]);

  // Randomize grid
  const randomizeGrid = useCallback(() => {
    if (!puzzle) return;

    setGameState(prev => ({
      ...prev,
      gridWords: shuffleArray(prev.gridWords),
      selectedWords: [], // Clear selection on shuffle
      shakingWords: [] // Clear any shaking animation
    }));
  }, [puzzle, shuffleArray]);

  // Reset game
  const resetGame = useCallback(() => {
    if (!puzzle) return;

    setGameState({
      selectedWords: [],
      completedCategories: [],
      attempts: 0,
      isComplete: false,
      shakingWords: [],
      gridWords: initializeGridWords(puzzle)
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
    resetGame
  };
};