import React, { useMemo } from 'react';
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

  // Calculate dynamic font size based on word length
  const dynamicFontSize = useMemo(() => {
    const baseSize = 22; // Base font size in px (increased from 14)
    const minSize = 12;  // Minimum font size (increased from 8)
    const maxSize = 28;  // Maximum font size (increased from 18)
    
    // Scale down font size based on word length
    // Shorter words get larger text, longer words get smaller text
    const lengthFactor = Math.max(0.5, 1 - (word.length - 3) * 0.06);
    const calculatedSize = Math.round(baseSize * lengthFactor);
    
    // Clamp to min/max bounds
    return Math.max(minSize, Math.min(maxSize, calculatedSize));
  }, [word]);

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