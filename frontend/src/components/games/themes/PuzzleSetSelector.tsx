import React, { useEffect, useState } from 'react';
import './PuzzleSetSelector.css';

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
}

export const PuzzleSetSelector: React.FC<PuzzleSetSelectorProps> = ({
  onSetSelected,
  selectedSet
}) => {
  const [puzzleSets, setPuzzleSets] = useState<PuzzleSet[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    loadPuzzleSets();
  }, []);

  const loadPuzzleSets = async () => {
    try {
      setLoading(true);
      setError(null);
      
      const baseURL = process.env.REACT_APP_API_URL || 'http://localhost:5050';
      const response = await fetch(`${baseURL}/api/games/themes/sets`, {
        credentials: 'include'
      });
      
      const data = await response.json();
      
      if (!data.success) {
        throw new Error(data.error || 'Failed to load puzzle sets');
      }
      
      setPuzzleSets(data.data.sets);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load puzzle sets');
    } finally {
      setLoading(false);
    }
  };

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
          <p>{error}</p>
          <button onClick={loadPuzzleSets} className="retry-button">
            Try Again
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="puzzle-set-selector">
      <h2>Choose a Puzzle Set</h2>
      <p className="selector-description">
        Each set contains 100 unique puzzles across different difficulty levels
      </p>
      
      <div className="puzzle-sets-grid">
        {puzzleSets.map((set) => (
          <div key={set.name} className="puzzle-set-card">
            <h3 className="set-name">{formatSetName(set.name)}</h3>
            
            <div className="set-versions">
              {set.versions.map((version) => (
                <div 
                  key={`${set.name}-${version.version}`}
                  className={`version-card ${
                    selectedSet === version.version 
                      ? 'selected' 
                      : ''
                  }`}
                  onClick={() => onSetSelected(version.version)}
                >
                  <div className="version-header">
                    <span className="version-name">{version.version}</span>
                    <span className="puzzle-count">{version.totalCount} puzzles</span>
                  </div>
                  
                  <div className="version-details">
                    <div className="available-sizes">
                      <span className="detail-label">Grid sizes:</span>
                      <div className="size-tags">
                        {version.availableSizes.map((size) => (
                          <span key={size} className="size-tag">
                            {size} ({version.sizeCounts[size] || 0})
                          </span>
                        ))}
                      </div>
                    </div>
                    
                    <div className="last-updated">
                      <span className="detail-label">Updated:</span>
                      <span>{formatDate(version.lastUpdated)}</span>
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
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};