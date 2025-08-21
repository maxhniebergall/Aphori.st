import React, { useEffect, useState } from 'react';
import { useShareableResults } from '../../../hooks/games/themes/useShareableResults';
import { FeedbackForm } from './FeedbackForm';
import './ShareModal.css';

interface ShareModalProps {
  isOpen: boolean;
  onClose: () => void;
  setName: string;
  puzzleNumber: number;
  puzzleId?: string;
}

export const ShareModal: React.FC<ShareModalProps> = ({ isOpen, onClose, setName, puzzleNumber, puzzleId }) => {
  const { shareableData, loading, error, fetchShareableResults, copyToClipboard } = useShareableResults();
  const [copySuccess, setCopySuccess] = useState(false);

  useEffect(() => {
    if (isOpen && !shareableData) {
      fetchShareableResults(setName, puzzleNumber);
    }
  }, [isOpen, setName, puzzleNumber, shareableData, fetchShareableResults]);


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
              <button onClick={() => fetchShareableResults(setName, puzzleNumber)}>Try Again</button>
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
                <button 
                  className="copy-button"
                  onClick={handleCopy}
                >
                  {copySuccess ? '✅ Copied!' : '📋 Copy'}
                </button>
              </div>

              {/* Feedback Form */}
              {puzzleId && (
                <FeedbackForm
                  puzzleId={puzzleId}
                  setName={setName}
                  puzzleNumber={puzzleNumber}
                />
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
};