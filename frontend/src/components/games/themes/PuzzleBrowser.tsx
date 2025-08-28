import React, { useEffect, useState, useMemo } from 'react';
import { Virtuoso } from 'react-virtuoso';
import { ThemesPuzzle } from '../../../hooks/games/themes/useThemesGame';
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
  const [puzzles, setPuzzles] = useState<ThemesPuzzle[]>([]);
  const [puzzleProgress, setPuzzleProgress] = useState<Map<number, PuzzleProgress>>(new Map());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Sort puzzles by puzzle number for consistent display - moved before early returns
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

  useEffect(() => {
    loadPuzzles();
  }, [setName, version]);

  useEffect(() => {
    if (puzzles.length > 0) {
      loadPuzzleProgress();
    }
  }, [puzzles, setName]);

  const loadPuzzles = async () => {
    try {
      setLoading(true);
      setError(null);
      
      // Use provided version or default to setName (following the backend pattern)
      const puzzleVersion = version || setName;
      
      const baseURL = process.env.REACT_APP_API_URL || 'http://localhost:5050';
      const response = await fetch(`${baseURL}/api/games/themes/sets/${setName}/${puzzleVersion}`, {
        credentials: 'include'
      });
      
      const data = await response.json();
      
      if (!data.success) {
        throw new Error(data.error || 'Failed to load puzzles');
      }
      
      setPuzzles(data.data.puzzles);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load puzzles');
    } finally {
      setLoading(false);
    }
  };

  const loadPuzzleProgress = async () => {
    try {
      const baseURL = process.env.REACT_APP_API_URL || 'http://localhost:5050';
      const progressMap = new Map<number, PuzzleProgress>();
      
      // Load progress for each puzzle
      await Promise.all(
        puzzles.map(async (puzzle) => {
          try {
            const puzzleId = `${setName}_${puzzle.puzzleNumber}`;
            const response = await fetch(`${baseURL}/api/games/themes/state/attempts/${puzzleId}`, {
              credentials: 'include'
            });
            
            if (response.ok) {
              const data = await response.json();
              if (data.success) {
                const attempts = data.data.attempts || [];
                const isCompleted = completedPuzzles.has(puzzle.puzzleNumber);
                
                let state: PuzzleProgressState;
                if (isCompleted) {
                  state = 'completed';
                } else if (attempts.length > 0) {
                  state = 'in-progress';
                } else {
                  state = 'not-started';
                }
                
                progressMap.set(puzzle.puzzleNumber, {
                  puzzleNumber: puzzle.puzzleNumber,
                  state,
                  attempts: attempts.length
                });
              }
            }
          } catch (err) {
            // If individual puzzle progress fails, default to basic state
            const isCompleted = completedPuzzles.has(puzzle.puzzleNumber);
            progressMap.set(puzzle.puzzleNumber, {
              puzzleNumber: puzzle.puzzleNumber,
              state: isCompleted ? 'completed' : 'not-started',
              attempts: 0
            });
          }
        })
      );
      
      setPuzzleProgress(progressMap);
    } catch (err) {
      console.error('Failed to load puzzle progress:', err);
      // Fallback: create basic progress map from completed puzzles
      const fallbackMap = new Map<number, PuzzleProgress>();
      puzzles.forEach(puzzle => {
        const isCompleted = completedPuzzles.has(puzzle.puzzleNumber);
        fallbackMap.set(puzzle.puzzleNumber, {
          puzzleNumber: puzzle.puzzleNumber,
          state: isCompleted ? 'completed' : 'not-started',
          attempts: 0
        });
      });
      setPuzzleProgress(fallbackMap);
    }
  };

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
          <button onClick={loadPuzzles} className="retry-button">
            Try Again
          </button>
        </div>
      </div>
    );
  }

  const completedCount = puzzles.filter(p => completedPuzzles.has(p.puzzleNumber)).length;
  const inProgressCount = Array.from(puzzleProgress.values()).filter(p => p.state === 'in-progress').length;
  const notStartedCount = puzzles.length - completedCount - inProgressCount;

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
          return `${attempts} attempt${attempts !== 1 ? 's' : ''}`;
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