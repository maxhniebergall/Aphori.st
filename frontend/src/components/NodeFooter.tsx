/**
 * Requirements:
 * - Render the reply button with proper text based on reply target state
 * - Render sibling navigation indicators (with current index and total sibling count)
 * - Provide click handlers for reply, next sibling, and previous sibling actions
 * - TypeScript support for props
 * - Yarn for package management
 */

import React from 'react';

interface NodeFooterProps {
  currentIndex: number;
  totalSiblings: number;
  onReplyClick: () => void;
  isReplyTarget: boolean;
  onNextSibling: () => void;
  onPreviousSibling: () => void;
}

const NodeFooter: React.FC<NodeFooterProps> = ({
  currentIndex,
  totalSiblings,
  onReplyClick,
  isReplyTarget,
  onNextSibling,
  onPreviousSibling,
}) => {
  // Ensure currentIndex and totalSiblings are valid numbers
  const validCurrentIndex = Number.isFinite(currentIndex) ? currentIndex : 0;
  const validTotalSiblings = Number.isFinite(totalSiblings) ? totalSiblings : 1;
  const hasSiblings = validTotalSiblings > 1;

  return (
    <div className="story-tree-node-footer">
      <div className="footer-left">
        <button className="reply-button" onClick={onReplyClick} aria-label="Reply to this message">
          {isReplyTarget ? 'Cancel Reply' : 'Reply'}
        </button>
      </div>
      <div className="footer-right"></div>
      {hasSiblings && (
        <div className="sibling-indicator">
          {validCurrentIndex + 1} / {validTotalSiblings}
          <span className="swipe-hint">
            {validCurrentIndex > 0 && (
              <span className="swipe-hint-previous" onClick={onPreviousSibling}>
                (Swipe right for previous)
              </span>
            )}
            {validCurrentIndex > 0 && validCurrentIndex < validTotalSiblings - 1 && ' | '}
            {validCurrentIndex < validTotalSiblings - 1 && (
              <span className="swipe-hint-next" onClick={onNextSibling}>
                (Swipe left for next)
              </span>
            )}
          </span>
        </div>
      )}
    </div>
  );
};

export default NodeFooter; 