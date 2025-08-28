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
      return calculateOptimalSize();
    }
    return 400; // Default fallback
  });

  // Dynamic calculation function
  function calculateOptimalSize(): number {
    if (typeof window === 'undefined') return 400;
    
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    
    // Get actual element heights dynamically
    const headerHeight = document.querySelector('.app-header')?.clientHeight || 60;
    const gameHeaderHeight = document.querySelector('.game-header')?.clientHeight || 80;
    const controlsHeight = document.querySelector('.game-controls')?.clientHeight || 100;
    const containerPadding = 40; // Total vertical padding/margins
    
    // Calculate actual UI space used
    const totalUIHeight = headerHeight + gameHeaderHeight + controlsHeight + containerPadding;
    
    // Available space for grid
    const availableHeight = vh - totalUIHeight - 20; // 20px safety margin
    const availableWidth = vw - 40; // 40px horizontal margins
    
    // Calculate optimal square size
    const maxSize = Math.min(availableHeight, availableWidth);
    
    // Apply reasonable limits based on screen size
    let optimalSize;
    if (vw < 400) {
      // Small phones: use most of available space
      optimalSize = Math.min(maxSize, vw - 20);
    } else if (vw < 768) {
      // Larger phones/small tablets: slightly constrained
      optimalSize = Math.min(maxSize, 500);
    } else if (vw < 1366) {
      // Tablets/small laptops: moderate constraint
      optimalSize = Math.min(maxSize, 600);
    } else {
      // Desktop: comfortable maximum
      optimalSize = Math.min(maxSize, 700);
    }
    
    // Ensure minimum viable size
    return Math.max(240, optimalSize);
  }

  // Update container size on window resize
  useEffect(() => {
    if (typeof window === 'undefined') return;
    
    const handleResize = () => {
      // Debounce resize calculations for performance
      setTimeout(() => {
        setContainerSize(calculateOptimalSize());
      }, 100);
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
        '--grid-size': gridSize
      } as React.CSSProperties & { [key: string]: string | number }}
    >
      <div 
        className="game-grid"
        data-grid-size={`${gridSize}x${gridSize}`}
        style={{
          gridTemplateColumns: `repeat(${gridSize}, 1fr)`,
          gridTemplateRows: `repeat(${gridSize}, 1fr)`,
          gap: `clamp(1px, ${(1.5 / gridSize)}cqi, ${Math.max(2, Math.round(containerSize * 0.015))}px)`
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