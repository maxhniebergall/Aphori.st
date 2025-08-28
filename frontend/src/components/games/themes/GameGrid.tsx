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
  
  // Calculate optimal container size for square grid
  const [containerSize, setContainerSize] = useState(() => {
    if (typeof window !== 'undefined') {
      const vw = window.innerWidth;
      const vh = window.innerHeight;
      // Reserve space for header, controls, and padding
      const availableHeight = vh - 200; // ~200px for header/controls/padding
      const availableWidth = Math.min(vw - 32, 700); // Max 700px width with 32px padding
      return Math.min(availableWidth, availableHeight);
    }
    return 400; // Default fallback
  });

  // Update container size on window resize
  useEffect(() => {
    if (typeof window === 'undefined') return;
    
    const calculateOptimalSize = () => {
      const vw = window.innerWidth;
      const vh = window.innerHeight;
      const availableHeight = vh - 200;
      const availableWidth = Math.min(vw - 32, 700);
      return Math.min(availableWidth, availableHeight);
    };
    
    const handleResize = () => {
      setContainerSize(calculateOptimalSize());
    };

    // Set initial size and add listener
    setContainerSize(calculateOptimalSize());
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

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
    
    // Debug log completed words
    if (completed.length > 0) {
      console.log('[GameGrid] Completed words:', JSON.stringify(completed.map(w => ({
        word: w.word,
        isCompleted: w.isCompleted,
        difficulty: w.difficulty
      })), null, 2));
    }
    
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
      className="game-grid-container"
      style={{
        width: `${containerSize}px`,
        height: `${containerSize}px`,
        '--container-size': `${containerSize}px`,
        '--grid-size': gridSize,
        '--gap-size': `${Math.max(2, Math.round(containerSize * 0.015))}px`
      } as React.CSSProperties & { [key: string]: string | number }}
    >
      <div 
        className="game-grid"
        data-grid-size={`${gridSize}x${gridSize}`}
        style={{
          gridTemplateColumns: `repeat(${gridSize}, 1fr)`,
          gridTemplateRows: `repeat(${gridSize}, 1fr)`,
          gap: `var(--gap-size)`
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
    </div>
  );
};