import React, { useEffect, useState } from 'react';
import { useShareableResults, ShareableResults } from '../../../hooks/games/themes/useShareableResults';
import './ShareModal.css';

interface ShareModalProps {
  isOpen: boolean;
  onClose: () => void;
  date: string;
}

export const ShareModal: React.FC<ShareModalProps> = ({ isOpen, onClose, date }) => {
  const { shareableData, loading, error, fetchShareableResults, copyToClipboard, shareNative } = useShareableResults();
  const [copySuccess, setCopySuccess] = useState(false);

  useEffect(() => {
    if (isOpen && !shareableData) {
      fetchShareableResults(date);
    }
  }, [isOpen, date, shareableData, fetchShareableResults]);

  const handleShare = async () => {
    const success = await shareNative();
    if (success) {
      setCopySuccess(true);
      setTimeout(() => setCopySuccess(false), 2000);
    }
  };

  const handleCopy = async () => {
    const success = await copyToClipboard();
    if (success) {
      setCopySuccess(true);
      setTimeout(() => setCopySuccess(false), 2000);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="share-modal-overlay" onClick={onClose}>
      <div className="share-modal-content" onClick={e => e.stopPropagation()}>
        <div className="share-modal-header">
          <h2>Share Your Results</h2>
          <button className="close-button" onClick={onClose}>×</button>
        </div>

        <div className="share-modal-body">
          {loading && (
            <div className="loading-state">
              <div className="loading-spinner"></div>
              <p>Generating shareable results...</p>
            </div>
          )}

          {error && (
            <div className="error-state">
              <p>Error: {error}</p>
              <button onClick={() => fetchShareableResults(date)}>Try Again</button>
            </div>
          )}

          {shareableData && (
            <>
              <div className="shareable-preview">
                <h3>Preview</h3>
                <div className="shareable-text">
                  <pre>{shareableData.shareableText}</pre>
                </div>
              </div>

              <div className="share-summary">
                <div className="summary-stats">
                  <span className="stat">
                    <strong>{shareableData.summary.completedPuzzles}</strong> of {shareableData.summary.totalPuzzles} puzzles completed
                  </span>
                  <span className="stat">
                    <strong>{shareableData.summary.totalAttempts}</strong> total attempts
                  </span>
                </div>
              </div>

              <div className="share-actions">
                {typeof navigator !== 'undefined' && 'share' in navigator && (
                  <button 
                    className="share-button primary"
                    onClick={handleShare}
                  >
                    📤 Share
                  </button>
                )}
                <button 
                  className="copy-button"
                  onClick={handleCopy}
                >
                  {copySuccess ? '✅ Copied!' : '📋 Copy'}
                </button>
              </div>

              <div className="legend">
                <h4>Legend</h4>
                <div className="legend-items">
                  <div className="legend-item">
                    <span className="emoji">🟨🟨🟨🟨</span>
                    <span>Yellow (Easy)</span>
                  </div>
                  <div className="legend-item">
                    <span className="emoji">🟩🟩🟩🟩</span>
                    <span>Green (Medium-Easy)</span>
                  </div>
                  <div className="legend-item">
                    <span className="emoji">🟦🟦🟦🟦</span>
                    <span>Blue (Medium-Hard)</span>
                  </div>
                  <div className="legend-item">
                    <span className="emoji">🟪🟪🟪🟪</span>
                    <span>Purple (Hardest)</span>
                  </div>
                  <div className="legend-item">
                    <span className="emoji">⬜⬜⬜⬜</span>
                    <span>Failed attempts</span>
                  </div>
                </div>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
};