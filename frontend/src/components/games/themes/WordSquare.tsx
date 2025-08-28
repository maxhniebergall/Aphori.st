import React, { useMemo, useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import './WordSquare.css';

interface WordSquareProps {
  word: string;
  isSelected: boolean;
  isShaking: boolean;
  onClick: () => void;
  disabled?: boolean;
  isCompleted?: boolean;
  difficulty?: 1 | 2 | 3 | 4;
  isAnimating?: boolean;
}

export const WordSquare: React.FC<WordSquareProps> = ({
  word,
  isSelected,
  isShaking,
  onClick,
  disabled = false,
  isCompleted = false,
  difficulty,
  isAnimating = false
}) => {
  // Debug log for completed words
  React.useEffect(() => {
    if (isCompleted) {
      console.log(`[WordSquare] Rendering completed word "${word}": isCompleted=${isCompleted}, difficulty=${difficulty}`);
    }
  }, [word, isCompleted, difficulty]);
  
  const upperCaseWord = useMemo(() => word.toUpperCase(), [word]);
  

  // Get actual cell size from parent grid container
  const [actualCellSize, setActualCellSize] = useState(100);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    
    const updateCellSize = () => {
      // Try to get actual container size from DOM
      const gridContainer = document.querySelector('.game-grid-container') as HTMLElement;
      const gridElement = document.querySelector('.game-grid') as HTMLElement;
      
      if (gridContainer && gridElement) {
        const containerSize = gridContainer.clientWidth;
        const gridComputedStyle = window.getComputedStyle(gridElement);
        const gap = parseFloat(gridComputedStyle.gap) || 6;
        
        // Calculate number of grid cells per row/column
        const gridCols = gridComputedStyle.gridTemplateColumns.split(' ').length;
        
        // Account for gaps: (gridCols - 1) gaps between cells
        const totalGapWidth = gap * (gridCols - 1);
        const usableWidth = containerSize - totalGapWidth;
        const cellSize = usableWidth / gridCols;
        
        setActualCellSize(Math.max(50, cellSize)); // Minimum 50px cell
      } else {
        // Fallback calculation
        const vw = window.innerWidth;
        const vh = window.innerHeight;
        const fallbackContainer = Math.min(vw - 40, vh - 200, 700);
        const fallbackCell = (fallbackContainer * 0.94) / 4; // 94% usable, 4x4 grid
        setActualCellSize(Math.max(50, fallbackCell));
      }
    };
    
    // Initial calculation
    setTimeout(updateCellSize, 0);
    
    // Update on resize
    const handleResize = () => {
      setTimeout(updateCellSize, 100);
    };
    
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  // Calculate dynamic font size based on actual cell dimensions and word length
  const dynamicFontSize = useMemo(() => {
    // Base font size as percentage of cell size
    let baseFontRatio = 0.25; // 25% of cell size
    let minSize = 8;
    let maxSize = Math.max(16, Math.round(actualCellSize * 0.5));
    
    // Adjust ratio for very small cells
    if (actualCellSize < 60) {
      baseFontRatio = 0.22;
      minSize = 6;
    } else if (actualCellSize < 80) {
      baseFontRatio = 0.23;
      minSize = 7;
    }
    
    // Calculate base size from cell dimensions
    let baseSize = Math.round(actualCellSize * baseFontRatio);
    
    // Scale down based on word length to ensure fit
    let lengthFactor = 1;
    if (word.length > 4) {
      const excessLength = word.length - 4;
      // More aggressive scaling for longer words
      lengthFactor = Math.max(0.3, 1 - (excessLength * 0.1));
    }
    
    const calculatedSize = Math.round(baseSize * lengthFactor);
    
    // Clamp to bounds
    return Math.max(minSize, Math.min(maxSize, calculatedSize));
  }, [word, actualCellSize]);

  const handleClick = () => {
    if (!disabled) {
      onClick();
    }
  };

  const handleKeyDown = (event: React.KeyboardEvent) => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      handleClick();
    }
  };

  // Get color based on difficulty
  const getCompletedColor = () => {
    if (isCompleted && difficulty === undefined) {
      console.warn(`[WordSquare] Completed word "${word}" has no difficulty set!`);
    }
    switch (difficulty) {
      case 1: return { backgroundColor: 'var(--difficulty-1-color)', borderColor: 'var(--difficulty-1-border)' };
      case 2: return { backgroundColor: 'var(--difficulty-2-color)', borderColor: 'var(--difficulty-2-border)' };
      case 3: return { backgroundColor: 'var(--difficulty-3-color)', borderColor: 'var(--difficulty-3-border)' };
      case 4: return { backgroundColor: 'var(--difficulty-4-color)', borderColor: 'var(--difficulty-4-border)' };
      default: return { backgroundColor: '#f6f7f8', borderColor: '#d3d6da' };
    }
  };

  // Animation variants - dynamically include completed colors
  const completedColors = isCompleted ? getCompletedColor() : {};
  
  const variants = {
    default: {
      backgroundColor: '#f6f7f8',
      borderColor: '#d3d6da',
      scale: 1,
      transition: { duration: 0.2 }
    },
    selected: {
      backgroundColor: '#5a67d8',
      borderColor: '#4c51bf',
      scale: 1,
      transition: { duration: 0.2 }
    },
    completed: {
      ...completedColors, // Include the difficulty colors here
      scale: 1,
      transition: { duration: 0.3, type: 'spring', stiffness: 300 }
    }
  };

  const currentVariant = isCompleted ? 'completed' : isSelected ? 'selected' : 'default';

  return (
    <motion.div
      layoutId={`word-${word}`}
      className={`word-square ${isSelected ? 'selected' : ''} ${isShaking ? 'shaking' : ''} ${disabled ? 'disabled' : ''} ${isCompleted ? 'completed' : ''} ${isAnimating ? 'animating' : ''}`}
      onClick={handleClick}
      onKeyDown={handleKeyDown}
      tabIndex={disabled ? -1 : 0}
      role="button"
      aria-pressed={isSelected}
      aria-label={`Word: ${word}`}
      variants={variants}
      initial="default"
      animate={currentVariant}
      layout
      transition={{
        layout: { duration: 0.6, type: 'spring', stiffness: 200, damping: 25 }
      }}
    >
      <motion.span 
        className="word-text" 
        style={{ fontSize: `${dynamicFontSize}px` }}
        animate={{
          color: isCompleted ? '#ffffff' : isSelected ? '#ffffff' : '#000000'
        }}
        transition={{ duration: 0.3 }}
      >
        {upperCaseWord}
      </motion.span>
    </motion.div>
  );
};