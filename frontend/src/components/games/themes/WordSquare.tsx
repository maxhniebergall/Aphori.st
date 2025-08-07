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
  const upperCaseWord = useMemo(() => word.toUpperCase(), [word]);
  
  // Track viewport width for responsive font sizing
  const [viewportWidth, setViewportWidth] = useState(window.innerWidth);
  
  useEffect(() => {
    const handleResize = () => {
      setViewportWidth(window.innerWidth);
    };
    
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  // Calculate dynamic font size based on word length and screen size
  const dynamicFontSize = useMemo(() => {
    
    // Define scaling parameters based on device categories
    let baseSize, minSize, maxSize, scalingFactor;
    
    if (viewportWidth <= 320) {
      // iPhone SE and smaller
      baseSize = 18;
      minSize = 10;
      maxSize = 22;
      scalingFactor = 0.10;
    } else if (viewportWidth <= 375) {
      // iPhone 12 mini, iPhone 13 mini
      baseSize = 20;
      minSize = 11;
      maxSize = 24;
      scalingFactor = 0.10;
    } else if (viewportWidth <= 480) {
      // Standard mobile phones
      baseSize = 24;
      minSize = 12;
      maxSize = 28;
      scalingFactor = 0.11;
    } else if (viewportWidth <= 640) {
      // Large phones
      baseSize = 28;
      minSize = 14;
      maxSize = 32;
      scalingFactor = 0.12;
    } else if (viewportWidth <= 768) {
      // iPad mini and small tablets
      baseSize = 32;
      minSize = 16;
      maxSize = 36;
      scalingFactor = 0.12;
    } else if (viewportWidth <= 1024) {
      // iPad and larger tablets
      baseSize = 34;
      minSize = 16;
      maxSize = 38;
      scalingFactor = 0.14;
    } else if (viewportWidth <= 1366) {
      // Small laptops
      baseSize = 28;
      minSize = 14;
      maxSize = 32;
      scalingFactor = 0.12;
    } else {
      // Desktop and larger screens
      baseSize = 30;
      minSize = 15;
      maxSize = 34;
      scalingFactor = 0.13;
    }
    
    // Adjust for smaller screens in landscape mode
    if (window.innerHeight < 800 && viewportWidth >= 1024) {
      baseSize = Math.round(baseSize * 0.85);
      minSize = Math.round(minSize * 0.85);
      maxSize = Math.round(maxSize * 0.85);
    }
    
    // Scale down font size based on word length
    // Shorter words get larger text, longer words get smaller text
    const lengthFactor = Math.max(0.4, 1 - (word.length - 3) * scalingFactor);
    const calculatedSize = Math.round(baseSize * lengthFactor);
    
    // Clamp to min/max bounds
    return Math.max(minSize, Math.min(maxSize, calculatedSize));
  }, [word, viewportWidth]);

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

  // Animation variants
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
      scale: 1,
      transition: { duration: 0.3, type: 'spring', stiffness: 300 }
    }
  };

  // Get color based on difficulty
  const getCompletedColor = () => {
    switch (difficulty) {
      case 1: return { backgroundColor: 'var(--difficulty-1-color)', borderColor: 'var(--difficulty-1-border)' };
      case 2: return { backgroundColor: 'var(--difficulty-2-color)', borderColor: 'var(--difficulty-2-border)' };
      case 3: return { backgroundColor: 'var(--difficulty-3-color)', borderColor: 'var(--difficulty-3-border)' };
      case 4: return { backgroundColor: 'var(--difficulty-4-color)', borderColor: 'var(--difficulty-4-border)' };
      default: return { backgroundColor: '#f6f7f8', borderColor: '#d3d6da' };
    }
  };

  const currentVariant = isCompleted ? 'completed' : isSelected ? 'selected' : 'default';
  const completedColors = isCompleted ? getCompletedColor() : {};

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
      style={{
        ...completedColors
      }}
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