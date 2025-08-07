import React, { useMemo, useState, useEffect } from 'react';
import './WordSquare.css';

interface WordSquareProps {
  word: string;
  isSelected: boolean;
  isShaking: boolean;
  onClick: () => void;
  disabled?: boolean;
}

export const WordSquare: React.FC<WordSquareProps> = ({
  word,
  isSelected,
  isShaking,
  onClick,
  disabled = false
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

  return (
    <div
      className={`word-square ${isSelected ? 'selected' : ''} ${isShaking ? 'shaking' : ''} ${disabled ? 'disabled' : ''}`}
      onClick={handleClick}
      onKeyDown={handleKeyDown}
      tabIndex={disabled ? -1 : 0}
      role="button"
      aria-pressed={isSelected}
      aria-label={`Word: ${word}`}
    >
      <span 
        className="word-text" 
        style={{ fontSize: `${dynamicFontSize}px` }}
      >
        {upperCaseWord}
      </span>
    </div>
  );
};