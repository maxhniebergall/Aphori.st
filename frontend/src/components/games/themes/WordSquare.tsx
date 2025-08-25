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
  
  // Track viewport width for responsive font sizing with SSR compatibility
  const [viewportWidth, setViewportWidth] = useState(() => {
    // Safely access window in client-side only
    if (typeof window !== 'undefined') {
      return window.innerWidth;
    }
    return 1024; // Default fallback for SSR
  });
  
  useEffect(() => {
    // Only add resize listeners on client-side
    if (typeof window === 'undefined') return;
    
    const handleResize = () => {
      setViewportWidth(window.innerWidth);
    };
    
    // Set initial value once mounted on client-side
    setViewportWidth(window.innerWidth);
    
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
      minSize = 6;
      maxSize = 22;
      scalingFactor = 0.15;
    } else if (viewportWidth <= 375) {
      // iPhone 12 mini, iPhone 13 mini
      baseSize = 20;
      minSize = 7;
      maxSize = 24;
      scalingFactor = 0.15;
    } else if (viewportWidth <= 480) {
      // Standard mobile phones
      baseSize = 24;
      minSize = 8;
      maxSize = 28;
      scalingFactor = 0.16;
    } else if (viewportWidth <= 640) {
      // Large phones
      baseSize = 28;
      minSize = 9;
      maxSize = 32;
      scalingFactor = 0.17;
    } else if (viewportWidth <= 768) {
      // iPad mini and small tablets
      baseSize = 32;
      minSize = 10;
      maxSize = 36;
      scalingFactor = 0.17;
    } else if (viewportWidth <= 1024) {
      // iPad and larger tablets
      baseSize = 34;
      minSize = 10;
      maxSize = 38;
      scalingFactor = 0.19;
    } else if (viewportWidth <= 1366) {
      // Small laptops
      baseSize = 28;
      minSize = 9;
      maxSize = 32;
      scalingFactor = 0.17;
    } else {
      // Desktop and larger screens
      baseSize = 30;
      minSize = 10;
      maxSize = 34;
      scalingFactor = 0.18;
    }
    
    // Adjust for smaller screens in landscape mode (SSR-safe)
    if (typeof window !== 'undefined' && window.innerHeight < 800 && viewportWidth >= 1024) {
      baseSize = Math.round(baseSize * 0.85);
      minSize = Math.round(minSize * 0.85);
      maxSize = Math.round(maxSize * 0.85);
    }
    
    // Very aggressive scaling based on word length to ensure single line fit
    // Apply exponential scaling for longer words with stricter minimum sizes
    let lengthFactor;
    if (word.length <= 3) {
      lengthFactor = 1;
    } else if (word.length <= 5) {
      lengthFactor = Math.max(0.7, 1 - (word.length - 3) * scalingFactor * 0.8);
    } else if (word.length <= 7) {
      lengthFactor = Math.max(0.5, 0.7 - (word.length - 5) * scalingFactor * 1.2);
    } else if (word.length <= 10) {
      lengthFactor = Math.max(0.3, 0.5 - (word.length - 7) * scalingFactor * 1.5);
    } else if (word.length <= 13) {
      lengthFactor = Math.max(0.2, 0.3 - (word.length - 10) * scalingFactor * 1.8);
    } else {
      // Very long words get extremely small
      lengthFactor = Math.max(0.15, 0.2 - (word.length - 13) * scalingFactor * 2.0);
    }
    
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