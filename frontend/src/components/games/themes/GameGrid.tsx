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

  // Enhanced calculation function for always-visible square grid
  function calculateOptimalSize(): number {
    if (typeof window === 'undefined') return 400;
    
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    
    // Get actual UI heights (with fallbacks)
    const headerHeight = document.querySelector('.app-header')?.clientHeight || 60;
    const gameHeaderHeight = document.querySelector('.game-header')?.clientHeight || 80;
    const controlsHeight = document.querySelector('.game-controls')?.clientHeight || 100;
    
    // Account for container padding and margins
    const containerPadding = 32; // 16px top + 16px bottom from .themes-game-container
    const additionalMargins = 20; // margin-top from container
    const scrollbarWidth = 20; // Conservative estimate for scrollbar
    
    // Much more conservative safety margin to ensure full visibility
    const safetyMargin = vh < 700 ? 25 : 40;
    
    // Calculate true available space
    const totalUIHeight = headerHeight + gameHeaderHeight + controlsHeight + containerPadding + additionalMargins;
    const availableHeight = vh - totalUIHeight - safetyMargin;
    const availableWidth = vw - containerPadding - scrollbarWidth;
    
    // Maximum square that fits in available space
    const maxPossibleSize = Math.min(availableHeight, availableWidth);
    
    // Special case for landscape laptops (1000-1200x650-800px)
    if (vw >= 1000 && vw <= 1200 && vh >= 650 && vh <= 800) {
      const landscapeAvailable = vh - totalUIHeight - 30; // More conservative
      const landscapeOptimal = Math.min(landscapeAvailable, vw * 0.45); // Much more conservative
      return Math.max(240, Math.floor(landscapeOptimal));
    }
    
    // Apply much more conservative constraints to ensure full grid visibility
    let optimalSize;
    if (maxPossibleSize < 300) {
      // Very small screens: use most available space
      optimalSize = maxPossibleSize * 0.85; // More conservative
    } else if (maxPossibleSize < 500) {
      // Medium screens: much more padding for comfort
      optimalSize = maxPossibleSize * 0.80; // Much more conservative
    } else {
      // Large screens: cap at reasonable maximum
      optimalSize = Math.min(maxPossibleSize * 0.82, 480); // Much more conservative
    }
    
    return Math.max(240, Math.floor(optimalSize));
  }

  // Update container size with ResizeObserver for more accurate updates
  useEffect(() => {
    if (typeof window === 'undefined') return;
    
    const updateSize = () => {
      setContainerSize(calculateOptimalSize());
    };
    
    // Set initial size
    updateSize();
    
    // Use ResizeObserver for more accurate updates, with fallback
    const handleResize = () => {
      setTimeout(updateSize, 100);
    };
    
    if (typeof ResizeObserver !== 'undefined') {
      const resizeObserver = new ResizeObserver((_entries) => {
        // Debounce updates for performance
        setTimeout(updateSize, 50);
      });
      
      // Observe all UI elements that affect available space
      const selectors = ['.app-header', '.game-header', '.game-controls', '.themes-game-container'];
      
      selectors.forEach(selector => {
        const element = document.querySelector(selector);
        if (element) {
          resizeObserver.observe(element);
        }
      });
      
      // Also listen to window resize as backup
      window.addEventListener('resize', handleResize);
      
      return () => {
        resizeObserver.disconnect();
        window.removeEventListener('resize', handleResize);
      };
    } else {
      // Fallback to window resize for older browsers
      window.addEventListener('resize', handleResize);
      return () => window.removeEventListener('resize', handleResize);
    }
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
        '--calculated-size': `${containerSize}px`,
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