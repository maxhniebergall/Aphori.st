import React, { useEffect } from 'react';
import './DuplicateAttemptModal.css';

interface DuplicateAttemptModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export const DuplicateAttemptModal: React.FC<DuplicateAttemptModalProps> = ({ 
  isOpen, 
  onClose 
}) => {
  // Auto-close after 2 seconds
  useEffect(() => {
    if (isOpen) {
      const timer = setTimeout(() => {
        onClose();
      }, 2000);

      return () => clearTimeout(timer);
    }
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  return (
    <div className="duplicate-modal-overlay" onClick={onClose}>
      <div className="duplicate-modal-content" onClick={(e) => e.stopPropagation()}>
        <div className="duplicate-modal-body">
          <div className="duplicate-icon">⚠️</div>
          <h3>You've already tried those words!</h3>
          <p>Try a different combination.</p>
        </div>
      </div>
    </div>
  );
};