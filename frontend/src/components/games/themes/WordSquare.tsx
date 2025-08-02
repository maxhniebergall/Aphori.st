import React from 'react';
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
      <span className="word-text">{word.toUpperCase()}</span>
    </div>
  );
};