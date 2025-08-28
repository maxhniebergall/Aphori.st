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
  

  // Get container size from CSS custom property if available
  const [containerSize, setContainerSize] = useState(() => {
    if (typeof window !== 'undefined') {
      return Math.min(window.innerWidth - 32, window.innerHeight - 200, 700);
    }
    return 400;
  });

  useEffect(() => {
    if (typeof window === 'undefined') return;
    
    const updateContainerSize = () => {
      const vw = window.innerWidth;
      const vh = window.innerHeight;
      const availableHeight = vh - 200;
      const availableWidth = Math.min(vw - 32, 700);
      setContainerSize(Math.min(availableWidth, availableHeight));
    };
    
    updateContainerSize();
    window.addEventListener('resize', updateContainerSize);
    return () => window.removeEventListener('resize', updateContainerSize);
  }, []);

  // Calculate dynamic font size based on container size and word length
  const dynamicFontSize = useMemo(() => {
    // Estimate cell size: (containerSize - gaps) / gridSize
    // Assume 4x4 grid for calculation (most common)
    const estimatedGapTotal = containerSize * 0.06; // ~6% for gaps
    const estimatedCellSize = (containerSize - estimatedGapTotal) / 4;
    
    // Base font size as percentage of cell size
    let baseFontRatio = 0.22; // 22% of cell size
    let minSize = 8;
    let maxSize = Math.max(16, Math.round(estimatedCellSize * 0.4));
    
    // Adjust for smaller containers
    if (containerSize < 300) {
      baseFontRatio = 0.18;
      minSize = 6;
    } else if (containerSize < 400) {
      baseFontRatio = 0.20;
      minSize = 7;
    }
    
    // Calculate base size from cell dimensions
    let baseSize = Math.round(estimatedCellSize * baseFontRatio);
    
    // Scale down based on word length
    let lengthFactor = 1;
    if (word.length > 3) {
      const excessLength = word.length - 3;
      lengthFactor = Math.max(0.2, 1 - (excessLength * 0.08));
    }
    
    const calculatedSize = Math.round(baseSize * lengthFactor);
    
    // Clamp to bounds
    return Math.max(minSize, Math.min(maxSize, calculatedSize));
  }, [word, containerSize]);

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