import React, { useEffect, useState } from 'react';
import { AnimatePresence } from 'framer-motion';
import { WordSquare } from './WordSquare';
import './GameGrid.css';

export interface GridWord {
  word: string;
  id: string;
  categoryId?: string;
  isCompleted?: boolean;
  difficulty?: 1 | 2 | 3 | 4;
  completedAt?: number;
}

interface GameGridProps {
  words: GridWord[];
  selectedWords: string[];
  shakingWords: string[];
  onWordClick: (_word: string) => void;
  gridSize: number;
  disabled?: boolean;
  _completedCategories?: string[];
  animatingWords?: string[];
}

export const GameGrid: React.FC<GameGridProps> = ({
  words,
  selectedWords,
  shakingWords,
  onWordClick,
  gridSize,
  disabled = false,
  _completedCategories = [],
  animatingWords = []
}) => {
  // State for managing animation sequences
  const [localAnimatingWords, setLocalAnimatingWords] = useState<string[]>([]);

  // Effect to handle completed category animations
  useEffect(() => {
    if (animatingWords.length > 0) {
      setLocalAnimatingWords(animatingWords);
      
      // Clear local animating state after animations complete
      const timeout = setTimeout(() => {
        setLocalAnimatingWords([]);
      }, 1000); // Total animation duration
      
      return () => clearTimeout(timeout);
    }
  }, [animatingWords]);

  // Sort words to put completed categories at the top
  const sortedWords = React.useMemo(() => {
    const completed = words.filter(word => word.isCompleted);
    const incomplete = words.filter(word => !word.isCompleted);
    
    // Sort completed words by difficulty (1-4) then by original position
    const sortedCompleted = completed.sort((a, b) => {
      if (a.difficulty && b.difficulty && a.difficulty !== b.difficulty) {
        return a.difficulty - b.difficulty;
      }
      return words.indexOf(a) - words.indexOf(b);
    });
    
    return [...sortedCompleted, ...incomplete];
  }, [words]);

  return (
    <div 
      className="game-grid"
      data-grid-size={`${gridSize}x${gridSize}`}
      style={{
        gridTemplateColumns: `repeat(${gridSize}, minmax(0, 1fr))`
      }}
    >
      <AnimatePresence>
        {sortedWords.map((gridWord) => (
          <WordSquare
            key={gridWord.id}
            word={gridWord.word}
            isSelected={selectedWords.includes(gridWord.word)}
            isShaking={shakingWords.includes(gridWord.word)}
            onClick={() => onWordClick(gridWord.word)}
            disabled={disabled}
            isCompleted={gridWord.isCompleted}
            difficulty={gridWord.difficulty}
            isAnimating={localAnimatingWords.includes(gridWord.word)}
          />
        ))}
      </AnimatePresence>
    </div>
  );
};