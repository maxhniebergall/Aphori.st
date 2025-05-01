import React from 'react';

interface CharCountProps {
  currentLength: number;
  maxLength: number;
  minLength?: number; // Optional minimum length
}

const CharCount: React.FC<CharCountProps> = ({ currentLength, maxLength, minLength = 0 }) => {
  const isError = currentLength > maxLength || (minLength > 0 && currentLength < minLength);

  const getDisplayText = () => {
    if (minLength > 0) {
      return `${currentLength} / ${minLength} (min) - ${maxLength} (max)`;
    }
    return `${currentLength} / ${maxLength}`;
  };

  return (
    <div
      className="char-count"
      style={{
        textAlign: 'left',
        fontSize: '0.8em',
        marginTop: '4px',
        color: isError ? 'red' : 'inherit'
      }}
      aria-live="polite" // Announce changes to screen readers
    >
      {getDisplayText()}
    </div>
  );
};

export default CharCount; 