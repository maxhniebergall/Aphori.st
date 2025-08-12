import React, { useEffect, useState } from 'react';
import { GameGrid } from '../../../components/games/themes/GameGrid';
import { GameControls } from '../../../components/games/themes/GameControls';
import { ShareModal } from '../../../components/games/themes/ShareModal';
import { useThemesGame } from '../../../hooks/games/themes/useThemesGame';
import './ThemesGame.css';

export const ThemesGame: React.FC = () => {
  // Always use today's date and start with puzzle 1
  const date = new Date().toISOString().split('T')[0];
  const puzzleNumber = 1;
  const [shareModalOpen, setShareModalOpen] = useState(false);
  
  const {
    gameState,
    puzzle,
    loading,
    error,
    selectWord,
    submitSelection,
    randomizeGrid,
    loadPuzzle,
    resetGame
  } = useThemesGame();

  // Load puzzle on mount or when props change
  useEffect(() => {
    loadPuzzle(date, puzzleNumber);
  }, [date, puzzleNumber, loadPuzzle]);

  const handleSubmit = async () => {
    await submitSelection();
  };

  const canSubmit = gameState.selectedWords.length === 4 && 
                   gameState.attempts < 4 && 
                   !gameState.isComplete;

  if (loading) {
    return (
      <div className="themes-game-container">
        <div className="loading-state">
          <div className="loading-spinner"></div>
          <p>Loading puzzle...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="themes-game-container">
        <div className="error-state">
          <h2>Oops! Something went wrong</h2>
          <p>{error}</p>
          <button 
            onClick={() => loadPuzzle(date, puzzleNumber)}
            className="retry-button"
          >
            Try Again
          </button>
        </div>
      </div>
    );
  }

  if (!puzzle) {
    return (
      <div className="themes-game-container">
        <div className="error-state">
          <h2>Puzzle Not Found</h2>
          <p>The requested puzzle could not be loaded.</p>
          <button 
            onClick={() => loadPuzzle(date, puzzleNumber)}
            className="retry-button"
          >
            Reload
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="themes-game-container">
      <div className="game-header">
        <h1>Themes</h1>
        <p className="game-description">
          Find groups of four words that share a common theme. test
        </p>
        <div className="puzzle-info">
          <span className="puzzle-date">{new Date(puzzle.date).toLocaleDateString()}</span>
          <span className="puzzle-difficulty">LEVEL {puzzle.difficulty}</span>
        </div>
      </div>

      {gameState.isComplete ? (
        <div className="game-complete">
          <h2>🎉 Puzzle Complete!</h2>
          <p>You found all {puzzle.categories.length} themes!</p>
          <div className="completion-stats">
            <span>Completed in {gameState.attempts} attempts</span>
          </div>
          <div className="completion-actions">
            <button onClick={() => setShareModalOpen(true)} className="share-button">
              📤 Share Results
            </button>
            <button onClick={resetGame} className="play-again-button">
              Play Again
            </button>
          </div>
        </div>
      ) : gameState.attempts >= 4 ? (
        <div className="game-over">
          <h2>Game Over</h2>
          <p>You've used all your attempts.</p>
          <div className="revealed-categories">
            <h3>The themes were:</h3>
            {puzzle.categories.map(category => (
              <div key={category.id} className="revealed-category">
                <strong>{category.themeWord}:</strong> {category.words.join(', ')}
              </div>
            ))}
          </div>
          <div className="game-over-actions">
            <button onClick={() => setShareModalOpen(true)} className="share-button">
              📤 Share Results
            </button>
            <button onClick={resetGame} className="try-again-button">
              Try Again
            </button>
          </div>
        </div>
      ) : (
        <>
          <GameGrid
            words={gameState.gridWords}
            selectedWords={gameState.selectedWords}
            shakingWords={gameState.shakingWords}
            onWordClick={selectWord}
            gridSize={puzzle.gridSize}
            _completedCategories={gameState.completedCategories}
            animatingWords={gameState.animatingWords}
          />

          <GameControls
            onSubmit={handleSubmit}
            onRandomize={randomizeGrid}
            canSubmit={canSubmit}
            isSubmitting={loading}
            selectedCount={gameState.selectedWords.length}
            requiredCount={4}
            currentPuzzle={puzzle.puzzleNumber}
            totalPuzzles={7} // Assuming 7 daily puzzles
            attempts={gameState.attempts}
            maxAttempts={4}
          />
        </>
      )}

      {/* Show completed categories */}
      {gameState.completedCategories.length > 0 && (
        <div className="completed-categories">
          <h3>Found Categories:</h3>
          {gameState.completedCategories.map(categoryId => {
            const category = puzzle.categories.find(c => c.id === categoryId);
            return category ? (
              <div key={categoryId} className="completed-category">
                <strong>{category.themeWord}:</strong> {category.words.join(', ')}
              </div>
            ) : null;
          })}
        </div>
      )}

      <ShareModal 
        isOpen={shareModalOpen}
        onClose={() => setShareModalOpen(false)}
        date={date}
      />
    </div>
  );
};