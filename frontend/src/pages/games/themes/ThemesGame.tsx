import React, { useEffect, useState } from 'react';
import { useParams, useNavigate, useLocation } from 'react-router-dom';
import { GameGrid } from '../../../components/games/themes/GameGrid';
import { GameControls } from '../../../components/games/themes/GameControls';
import { ShareModal } from '../../../components/games/themes/ShareModal';
import { PuzzleSetSelector } from '../../../components/games/themes/PuzzleSetSelector';
import { PuzzleBrowser } from '../../../components/games/themes/PuzzleBrowser';
import { useThemesGame } from '../../../hooks/games/themes/useThemesGame';
import { usePuzzleCompletion } from '../../../hooks/games/themes/usePuzzleCompletion';
import { usePuzzleAnalytics } from '../../../hooks/games/themes/usePuzzleAnalytics';
import './ThemesGame.css';

type GameView = 'setSelection' | 'puzzleBrowser' | 'playing';

export const ThemesGame: React.FC = () => {
  const navigate = useNavigate();
  const params = useParams<{
    setName?: string;
    puzzleNumber?: string;
  }>();
  
  const [shareModalOpen, setShareModalOpen] = useState(false);
  const [viewingCompletedGame, setViewingCompletedGame] = useState(false);
  
  // Derive state from URL parameters
  const selectedSet = params.setName ? decodeURIComponent(params.setName) : null;
  
  const currentPuzzleNumber = params.puzzleNumber ? parseInt(params.puzzleNumber, 10) : null;
  
  // Determine current view based on URL parameters
  const getCurrentView = (): GameView => {
    if (currentPuzzleNumber) return 'playing';
    if (selectedSet) return 'puzzleBrowser';
    return 'setSelection';
  };
  
  const currentView = getCurrentView();
  
  const {
    gameState,
    puzzle,
    loading,
    error,
    selectWord,
    submitSelection,
    randomizeGrid,
    loadPuzzleFromSet,
    resetGame
  } = useThemesGame();

  const {
    completedPuzzles,
    markPuzzleCompleted,
    getCompletionStats
  } = usePuzzleCompletion(
    selectedSet || '',
    selectedSet || '', // Keep second param for compatibility, but use same value
    100 // Assuming 100 puzzles per set
  );

  const { trackPuzzleView } = usePuzzleAnalytics();

  // Handle set selection
  const handleSetSelected = (setName: string) => {
    navigate(`/games/themes/${encodeURIComponent(setName)}`);
  };

  // Handle puzzle selection
  const handlePuzzleSelected = (puzzleNumber: number) => {
    if (selectedSet) {
      navigate(`/games/themes/${encodeURIComponent(selectedSet)}/puzzle/${puzzleNumber}`);
    }
  };

  // Handle back to set selection
  const handleBackToSetSelection = () => {
    navigate('/games/themes');
  };

  // Handle back to puzzle browser
  const handleBackToPuzzleBrowser = () => {
    if (selectedSet) {
      navigate(`/games/themes/${encodeURIComponent(selectedSet)}`);
    }
  };

  // Load puzzle when URL parameters change
  useEffect(() => {
    if (selectedSet && currentPuzzleNumber) {
      loadPuzzleFromSet(selectedSet, selectedSet, currentPuzzleNumber);
    }
  }, [selectedSet, currentPuzzleNumber, loadPuzzleFromSet]);

  // Mark puzzle as completed when the game is completed
  useEffect(() => {
    if (gameState.isComplete && currentPuzzleNumber && selectedSet) {
      markPuzzleCompleted(currentPuzzleNumber);
    }
  }, [gameState.isComplete, currentPuzzleNumber, selectedSet, markPuzzleCompleted]);

  // Track puzzle view when puzzle loads
  useEffect(() => {
    if (puzzle && selectedSet && currentPuzzleNumber) {
      trackPuzzleView(puzzle.id, selectedSet, currentPuzzleNumber);
    }
  }, [puzzle, selectedSet, currentPuzzleNumber, trackPuzzleView]);

  const handleSubmit = async () => {
    await submitSelection();
  };

  const canSubmit = gameState.selectedWords.length === 4 && 
                   gameState.attempts < 4 && 
                   !gameState.isComplete;

  // Render different views based on current state
  if (currentView === 'setSelection') {
    return (
      <div className="themes-game-container">
        <PuzzleSetSelector 
          onSetSelected={handleSetSelected}
          selectedSet={selectedSet}
        />
      </div>
    );
  }

  if (currentView === 'puzzleBrowser' && selectedSet) {
    return (
      <div className="themes-game-container">
        <PuzzleBrowser
          setName={selectedSet}
          version={selectedSet}
          onPuzzleSelected={handlePuzzleSelected}
          onBackToSetSelection={handleBackToSetSelection}
          completedPuzzles={completedPuzzles}
        />
      </div>
    );
  }

  // Playing view
  if (loading) {
    return (
      <div className="themes-game-container">
        <div className="game-header">
          <button onClick={handleBackToPuzzleBrowser} className="back-button">
            ← Back to Puzzles
          </button>
          <h1>Themes</h1>
        </div>
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
        <div className="game-header">
          <button onClick={handleBackToPuzzleBrowser} className="back-button">
            ← Back to Puzzles
          </button>
          <h1>Themes</h1>
        </div>
        <div className="error-state">
          <h2>Oops! Something went wrong</h2>
          <p>{error}</p>
          <button 
            onClick={() => {
              if (selectedSet && currentPuzzleNumber) {
                loadPuzzleFromSet(selectedSet, selectedSet, currentPuzzleNumber);
              }
            }}
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
        <div className="game-header">
          <button onClick={handleBackToPuzzleBrowser} className="back-button">
            ← Back to Puzzles
          </button>
          <h1>Themes</h1>
        </div>
        <div className="error-state">
          <h2>Puzzle Not Found</h2>
          <p>The requested puzzle could not be loaded.</p>
          <button 
            onClick={() => {
              if (selectedSet && currentPuzzleNumber) {
                loadPuzzleFromSet(selectedSet, selectedSet, currentPuzzleNumber);
              }
            }}
            className="retry-button"
          >
            Reload
          </button>
        </div>
      </div>
    );
  }

  const formatSetName = (name: string) => {
    return name.charAt(0).toUpperCase() + name.slice(1);
  };

  const getDifficultyClass = (difficulty: number) => {
    if (difficulty <= 2) return 'easy';
    if (difficulty <= 4) return 'medium';
    if (difficulty <= 6) return 'hard';
    return 'expert';
  };

  return (
    <div className="themes-game-container">
      <div className="game-header">
        <button onClick={handleBackToPuzzleBrowser} className="back-button">
          ← Back to Puzzles
        </button>
        <div className="header-content">
          <h1>Themes</h1>
          <p className="game-description">
            Find groups of four words that share a common theme.
          </p>
          <div className="puzzle-info">
            <span className="puzzle-set">{formatSetName(selectedSet || '')}</span>
            <span className="puzzle-number">Puzzle #{currentPuzzleNumber}</span>
            <span className={`puzzle-difficulty ${getDifficultyClass(puzzle.difficulty)}`}>LEVEL {puzzle.difficulty}</span>
          </div>
        </div>
      </div>

      {gameState.isComplete && viewingCompletedGame ? (
        <div className="completed-game-view">
          <div className="completed-game-header">
            <h2>🎉 Completed Puzzle</h2>
            <p>All {puzzle.categories.length} themes found in {gameState.attempts} attempts</p>
            <button onClick={() => setViewingCompletedGame(false)} className="back-to-results-button">
              ← Back to Results
            </button>
          </div>
          
          <GameGrid
            words={gameState.gridWords}
            selectedWords={[]}
            shakingWords={[]}
            onWordClick={() => {}}
            gridSize={puzzle.gridSize}
            disabled={true}
            _completedCategories={gameState.completedCategories}
            animatingWords={[]}
          />
        </div>
      ) : gameState.isComplete ? (
        <div className="game-complete">
          <h2>🎉 Puzzle Complete!</h2>
          <p>You found all {puzzle.categories.length} themes!</p>
          <div className="completion-stats">
            <span>Completed in {gameState.attempts} attempts</span>
          </div>
          <div className="completion-actions">
            <button onClick={() => setViewingCompletedGame(true)} className="view-completed-button">
              🎯 View Completed Puzzle
            </button>
            <button onClick={() => setShareModalOpen(true)} className="share-button">
              📤 Share Results
            </button>
            <button onClick={handleBackToPuzzleBrowser} className="back-to-browser-button">
              Choose Next Puzzle
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
            <button onClick={handleBackToPuzzleBrowser} className="back-to-browser-button">
              Choose Next Puzzle
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
            currentPuzzle={currentPuzzleNumber || 0}
            totalPuzzles={100}
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
        setName={selectedSet || ''}
        puzzleNumber={currentPuzzleNumber || 0}
        puzzleId={puzzle?.id}
      />
    </div>
  );
};