import React, { useMemo } from 'react';
import { Virtuoso } from 'react-virtuoso';
import { ThemesPuzzle } from '../../../hooks/games/themes/useThemesGame';
import { useThemePuzzlesInSet } from '../../../hooks/games/themes/queries';
import './PuzzleBrowser.css';

interface PuzzleBrowserProps {
  setName: string;
  version?: string;
  onPuzzleSelected: (puzzleNumber: number) => void;
  onBackToSetSelection: () => void;
  completedPuzzles?: Set<number>;
}

type PuzzleProgressState = 'not-started' | 'in-progress' | 'completed';

interface PuzzleProgress {
  puzzleNumber: number;
  state: PuzzleProgressState;
  attempts: number;
}

export const PuzzleBrowser: React.FC<PuzzleBrowserProps> = ({
  setName,
  version,
  onPuzzleSelected,
  onBackToSetSelection,
  completedPuzzles = new Set()
}) => {
  // Use provided version or default to setName (following the backend pattern)
  const puzzleVersion = version || setName;
  
  // Load puzzles using TanStack Query
  const { data: puzzles = [], isLoading: loading, error: puzzlesError, refetch: refetchPuzzles } = useThemePuzzlesInSet(setName, puzzleVersion);

  // Compute puzzle progress from the completed puzzles set only
  // For now, we'll simplify by not loading individual attempts to avoid hook rule violations
  // This is a common pattern for puzzle browsers where we only need completion status
  const puzzleProgress = useMemo(() => {
    const progressMap = new Map<number, PuzzleProgress>();
    
    puzzles.forEach((puzzle) => {
      const isCompleted = completedPuzzles.has(puzzle.puzzleNumber);
      
      let state: PuzzleProgressState;
      if (isCompleted) {
        state = 'completed';
      } else {
        // For now, we'll assume all non-completed puzzles are 'not-started'
        // In the future, we could implement a batch API to get attempt counts
        state = 'not-started';
      }
      
      progressMap.set(puzzle.puzzleNumber, {
        puzzleNumber: puzzle.puzzleNumber,
        state,
        attempts: 0 // We'll set this to 0 for now
      });
    });
    
    return progressMap;
  }, [puzzles, completedPuzzles]);

  // Simplified error state - only from puzzles query
  const error = puzzlesError?.message || null;

  // Sort puzzles by puzzle number for consistent display
  const sortedPuzzles = useMemo(() => {
    return [...puzzles].sort((a, b) => a.puzzleNumber - b.puzzleNumber);
  }, [puzzles]);

  // Group puzzles into rows for grid display
  const puzzleRows = useMemo(() => {
    const rows = [];
    const puzzlesPerRow = 3; // Fixed number of puzzles per row for consistent layout
    
    for (let i = 0; i < sortedPuzzles.length; i += puzzlesPerRow) {
      rows.push(sortedPuzzles.slice(i, i + puzzlesPerRow));
    }
    return rows;
  }, [sortedPuzzles]);

  const formatSetName = (name: string) => {
    return name.charAt(0).toUpperCase() + name.slice(1);
  };

  if (loading) {
    return (
      <div className="puzzle-browser">
        <div className="browser-header">
          <div className="header-top">
            <button onClick={onBackToSetSelection} className="back-button">
              ← Back to Sets
            </button>
            <h2>{formatSetName(setName)}</h2>
          </div>
        </div>
        
        <div className="loading-state">
          <div className="loading-spinner"></div>
          <p>Loading puzzles...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="puzzle-browser">
        <div className="browser-header">
          <div className="header-top">
            <button onClick={onBackToSetSelection} className="back-button">
              ← Back to Sets
            </button>
            <h2>{formatSetName(setName)}</h2>
          </div>
        </div>
        
        <div className="error-state">
          <h3>Failed to load puzzles</h3>
          <p>{error}</p>
          <button onClick={() => refetchPuzzles()} className="retry-button">
            Try Again
          </button>
        </div>
      </div>
    );
  }

  const completedCount = puzzles.filter(p => completedPuzzles.has(p.puzzleNumber)).length;
  const inProgressCount = 0; // We're not tracking in-progress state anymore
  const notStartedCount = puzzles.length - completedCount;

  // Grid item component
  const PuzzleCard = React.memo(({ puzzle }: { puzzle: ThemesPuzzle }) => {
    const progress = puzzleProgress.get(puzzle.puzzleNumber);
    const state = progress?.state || 'not-started';
    const attempts = progress?.attempts || 0;
    
    const getProgressIcon = () => {
      switch (state) {
        case 'completed':
          return '✓';
        case 'in-progress':
          return '○';
        default:
          return '●';
      }
    };
    
    const getProgressLabel = () => {
      switch (state) {
        case 'completed':
          return 'Completed';
        case 'in-progress':
          return 'In progress';
        default:
          return 'Not started';
      }
    };
    
    const getButtonText = () => {
      switch (state) {
        case 'completed':
          return 'Play Again';
        case 'in-progress':
          return 'Continue';
        default:
          return 'Play';
      }
    };
    
    return (
      <div
        className={`puzzle-card ${state}`}
        onClick={() => onPuzzleSelected(puzzle.puzzleNumber)}
      >
        <div className="puzzle-number">#{puzzle.puzzleNumber}</div>
        
        <div className="progress-indicator">
          <span className="progress-icon">{getProgressIcon()}</span>
          <span className="progress-label">{getProgressLabel()}</span>
        </div>

        <div className="play-button">
          {getButtonText()}
        </div>
      </div>
    );
  });

  return (
    <div className="puzzle-browser">
      <div className="browser-header">
        <div className="header-top">
          <button onClick={onBackToSetSelection} className="back-button">
            ← Back to Sets
          </button>
          <div className="puzzleSet-name"><h2>{formatSetName(setName)}</h2></div>
        </div>
        <div className="header-content">
          <div className="progress-summary">
            <span className="progress-text">
              {completedCount} completed • {inProgressCount} in progress • {notStartedCount} not started
            </span>
            <div className="progress-bar">
              <div 
                className="progress-fill"
                style={{ width: `${(completedCount / puzzles.length) * 100}%` }}
              />
            </div>
          </div>
        </div>
      </div>

      <div className="puzzles-grid-container">
        <Virtuoso
          totalCount={puzzleRows.length}
          overscan={5}
          itemContent={(rowIndex) => (
            <div className="puzzle-row">
              {puzzleRows[rowIndex].map((puzzle) => (
                <PuzzleCard key={puzzle.id} puzzle={puzzle} />
              ))}
            </div>
          )}
        />
      </div>
    </div>
  );
};