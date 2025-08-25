import React from 'react';
import './GameControls.css';

interface GameControlsProps {
  onSubmit: () => void;
  onRandomize: () => void;
  canSubmit: boolean;
  isSubmitting: boolean;
  selectedCount: number;
  requiredCount: number;
  currentPuzzle: number;
  totalPuzzles: number;
  attempts: number;
  maxAttempts?: number;
}

export const GameControls: React.FC<GameControlsProps> = ({
  onSubmit,
  onRandomize,
  canSubmit,
  isSubmitting,
  selectedCount,
  requiredCount,
  currentPuzzle,
  totalPuzzles,
  attempts,
  maxAttempts = 4
}) => {
  return (
    <div className="game-controls">
      <div className="game-stats">
        <div className="puzzle-progress">
          Puzzle {currentPuzzle} of {totalPuzzles}
        </div>
        <div className="attempts-remaining">
          {maxAttempts - attempts} attempts remaining
        </div>
      </div>

      <div className="selection-feedback">
        {selectedCount === 0 && (
          <span className="feedback-text">Select {requiredCount} words that share a theme</span>
        )}
        {selectedCount > 0 && selectedCount < requiredCount && (
          <span className="feedback-text">
            {requiredCount - selectedCount} more word{requiredCount - selectedCount !== 1 ? 's' : ''} needed
          </span>
        )}
        {selectedCount === requiredCount && (
          <span className="feedback-text ready">Ready to submit!</span>
        )}
        {selectedCount > requiredCount && (
          <span className="feedback-text error">
            Too many words selected ({selectedCount}/{requiredCount})
          </span>
        )}
      </div>

      <div className="control-buttons">
        <button
          className="randomize-button"
          onClick={onRandomize}
          disabled={isSubmitting}
          type="button"
        >
          🔀 Shuffle
        </button>

        <button
          className="submit-button"
          onClick={onSubmit}
          disabled={!canSubmit || isSubmitting}
          type="button"
        >
          {isSubmitting ? 'Checking...' : 'Submit'}
        </button>
      </div>
    </div>
  );
};