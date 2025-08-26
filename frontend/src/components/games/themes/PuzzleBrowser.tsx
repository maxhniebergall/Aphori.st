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

export const PuzzleBrowser: React.FC<PuzzleBrowserProps> = ({
  setName,
  version,
  onPuzzleSelected,
  onBackToSetSelection,
  completedPuzzles = new Set()
}) => {
  const [puzzles, setPuzzles] = useState<ThemesPuzzle[]>([]);
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

  const formatSetName = (name: string) => {
    return name.charAt(0).toUpperCase() + name.slice(1);
  };



  if (loading) {
    return (
      <div className="puzzle-browser">
        <div className="browser-header">
          <button onClick={onBackToSetSelection} className="back-button">
            ← Back to Sets
          </button>
          <h2>{formatSetName(setName)}</h2>
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
          <button onClick={onBackToSetSelection} className="back-button">
            ← Back to Sets
          </button>
          <h2>{formatSetName(setName)}</h2>
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

  // Grid item component
  const PuzzleCard = React.memo(({ puzzle }: { puzzle: ThemesPuzzle }) => {
    const isCompleted = completedPuzzles.has(puzzle.puzzleNumber);
    
    return (
      <div
        className={`puzzle-card ${isCompleted ? 'completed' : ''}`}
        onClick={() => onPuzzleSelected(puzzle.puzzleNumber)}
      >
        <div className="puzzle-number">#{puzzle.puzzleNumber}</div>
        


        {isCompleted && (
          <div className="completion-badge">
            ✓ Completed
          </div>
        )}

        <div className="play-button">
          {isCompleted ? 'Play Again' : 'Play'}
        </div>
      </div>
    );
  });

  return (
    <div className="puzzle-browser">
      <div className="browser-header">
        <button onClick={onBackToSetSelection} className="back-button">
          ← Back to Sets
        </button>
        <div className="header-content">
          <div className="progress-summary">
            <span className="progress-text">
              {completedCount} of {puzzles.length} completed
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