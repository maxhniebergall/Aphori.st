import React from 'react';
import './PuzzleSetSelector.css';
import { useThemeSets } from '../../../hooks/games/themes/queries';

export interface PuzzleSet {
  name: string;
  versions: PuzzleSetVersion[];
}

export interface PuzzleSetVersion {
  version: string;
  totalCount: number;
  lastUpdated: number;
  availableSizes: string[];
  sizeCounts: Record<string, number>;
}

interface PuzzleSetSelectorProps {
  onSetSelected: (setName: string) => void;
  selectedSet?: string | null;
  completedPuzzles?: Set<number>;
}

export const PuzzleSetSelector: React.FC<PuzzleSetSelectorProps> = ({
  onSetSelected,
  selectedSet,
  completedPuzzles = new Set()
}) => {
  const { 
    data: puzzleSets = [], 
    isLoading: loading, 
    error, 
    refetch: loadPuzzleSets 
  } = useThemeSets();

  const formatSetName = (name: string) => {
    return name.charAt(0).toUpperCase() + name.slice(1);
  };

  const formatDate = (timestamp: number) => {
    return new Date(timestamp).toLocaleDateString();
  };

  if (loading) {
    return (
      <div className="puzzle-set-selector">
        <div className="loading-state">
          <div className="loading-spinner"></div>
          <p>Loading puzzle sets...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="puzzle-set-selector">
        <div className="error-state">
          <h3>Failed to load puzzle sets</h3>
          <p>{error instanceof Error ? error.message : 'Failed to load puzzle sets'}</p>
          <button onClick={() => loadPuzzleSets()} className="retry-button">
            Try Again
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="puzzle-set-selector">
      <h2>Themes Puzzle Sets</h2>
      <p className="selector-description">
        Select the 4 words matching the theme. 
      </p>
      
      <div className="puzzle-sets-grid">
        {puzzleSets.map((set) => (
          <div key={set.name} className="puzzle-set-card">
            <h3 className="set-name">{formatSetName(set.name)}</h3>
            
            <div className="set-versions">
              {set.versions.map((version) => {
                const completedCount = Array.from(completedPuzzles).filter((puzzleNum: number) => 
                  puzzleNum >= 1 && puzzleNum <= version.totalCount
                ).length;
                
                return (
                  <div 
                    key={`${set.name}-${version.version}`}
                    className={`version-card ${
                      selectedSet === version.version 
                        ? 'selected' 
                        : ''
                    }`}
                    onClick={() => onSetSelected(version.version)}
                  >
                    
                    <div className="version-details">
                      <div className="progress-summary">
                        <span className="puzzle-count">
                          {completedCount} of {version.totalCount} completed
                        </span>
                        <div className="progress-bar">
                          <div 
                            className="progress-fill"
                            style={{ width: `${(completedCount / version.totalCount) * 100}%` }}
                          />
                        </div>
                      </div>
                    </div>
                    
                    <div className="version-actions">
                      <button className="select-set-button">
                        {selectedSet === version.version 
                          ? 'Selected' 
                          : 'Select Set'
                        }
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};