/**
 * Requirements:
 * - Render the reply button with proper text based on reply target state
 * - Render sibling navigation indicators (with current index and total sibling count)
 * - Provide click handlers for reply, next sibling, and previous sibling actions
 * - TypeScript support for props
 * - Yarn for package management
 */

import React, { useCallback } from 'react';
import { useReplyContext } from '../context/ReplyContext';
import { StoryTreeNode } from '../types/types';
import { Quote } from '../types/quote';

interface NodeFooterProps {
  nodeData: StoryTreeNode;
  currentIndex: number;
  totalSiblings: number;
  onReplyClick: () => void;
  isReplyTarget: boolean;
  onNextSibling: () => void;
  onPreviousSibling: () => void;
  isReplyActive?: boolean;
  replyError?: string | null;
}

const NodeFooter: React.FC<NodeFooterProps> = ({
  nodeData,
  currentIndex,
  totalSiblings,
  onReplyClick,
  isReplyTarget,
  onNextSibling,
  onPreviousSibling,
  isReplyActive = false,
  replyError = null
}) => {
  // Get context functions
  const { setReplyTarget, setReplyContent, setIsReplyOpen, setReplyQuote, setReplyError } = useReplyContext();

  // Ensure currentIndex and totalSiblings are valid numbers
  const validCurrentIndex = Number.isFinite(currentIndex) ? currentIndex : 0;
  const validTotalSiblings = Number.isFinite(totalSiblings) ? totalSiblings : 1;
  const hasSiblings = validTotalSiblings > 1;

  // Determine appropriate button text based on reply state
  const getReplyButtonText = () => {
    if (isReplyTarget) {
      return 'Cancel Reply';
    }
    if (isReplyActive) {
      return 'Select Different Node';
    }
    return 'Reply';
  };

  // Determine appropriate button class based on reply state and errors
  const getReplyButtonClass = () => {
    const baseClass = 'reply-button';
    if (replyError) {
      return `${baseClass} reply-button-error`;
    }
    if (isReplyTarget) {
      return `${baseClass} reply-button-active`;
    }
    if (isReplyActive) {
      return `${baseClass} reply-button-disabled`;
    }
    return baseClass;
  };

  const replyButtonClicked = useCallback(() => {
    // Add logs or state updates for debugging
    
  }, [isReplyTarget, isReplyActive]);

  const previousSiblingClicked = useCallback(() => {
    // Add logs or state updates for debugging
    
  }, [currentIndex, totalSiblings]);

  const nextSiblingClicked = useCallback(() => {
    // Add logs or state updates for debugging
    
  }, [currentIndex, totalSiblings]);

  // Handler for upvote click
  const handleUpvoteClick = useCallback(() => {
    // Create the default quote spanning the entire text
    const defaultQuote = new Quote(
      nodeData.textContent, // Use the full trimmed text
      nodeData.id, // Provide the sourceId
      { start: 0, end: nodeData.textContent.length } // Range covering the whole text
    );
    setReplyQuote(defaultQuote); // Set the default quote
    setReplyTarget(nodeData);
    setReplyContent("Yes!");
    setIsReplyOpen(true);
    setReplyError(null); // Clear any previous errors
  }, [nodeData, setReplyTarget, setReplyContent, setIsReplyOpen]);

  return (
    <div className="story-tree-node-footer">
      <div className="footer-left">
        <div className="footer-left-upvote" onClick={handleUpvoteClick}>
          {upvoteSVG()}
        </div>
        <button 
          className={getReplyButtonClass()} 
          onClick={() => { 
            replyButtonClicked();
            onReplyClick();
          }} 
          aria-label={`${getReplyButtonText()} to this message`}
        >
          {getReplyButtonText()}
        </button>
      </div>
      <div className="footer-right"></div>
      {hasSiblings && !isReplyTarget && (
        <div className="sibling-indicator">
          {validCurrentIndex + 1} / {validTotalSiblings}
          <div className="swipe-hint">
            { validCurrentIndex > 0 && (
              <span className="swipe-hint-previous" onClick={() => { 
                previousSiblingClicked();
                onPreviousSibling();
              }}>
                (Swipe right for previous)
              </span>
            )}
            { validCurrentIndex > 0 && validCurrentIndex < validTotalSiblings - 1 && ' | ' }
            { validCurrentIndex < validTotalSiblings - 1 && (
              <span className="swipe-hint-next" onClick={() => { 
                nextSiblingClicked();
                onNextSibling();
              }}>
                (Swipe left for next)
              </span>
            )}
          </div>
        </div>
      )}
    </div>
  );
};

export default NodeFooter; 

function upvoteSVG() {
  return <svg version="1.1" id="Icons" xmlns="http://www.w3.org/2000/svg" xmlnsXlink="http://www.w3.org/1999/xlink" viewBox="0 0 32 32" xmlSpace="preserve" fill="none" width="77" height="40" stroke="currentColor">
    <g id="SVGRepo_bgCarrier" strokeWidth="0"></g>
    <g id="SVGRepo_tracerCarrier" strokeLinecap="round" strokeLinejoin="round"></g>
    <g id="SVGRepo_iconCarrier">
      <g id="SVGRepo_bgCarrier" strokeWidth="0"></g>
      <g id="SVGRepo_tracerCarrier" strokeLinecap="round" strokeLinejoin="round"></g>
      <g id="SVGRepo_iconCarrier">
        <path
          className="st0"
          d="M16.8,9.3l9.4,9.3c1,1,1,2.6,0,3.6l0,0c-1,1-2.6,1-3.6,0l-5.8-5.7c-0.5-0.5-1.2-0.5-1.7,0l-5.8,5.7 c-1,1-2.6,1-3.6,0l0,0c-1-1-1-2.6,0-3.6l9.4-9.3C15.6,8.9,16.4,8.9,16.8,9.3z"
          fill="#90EE90"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeMiterlimit="10"
          transform="translate(0, -3)"
        >
        </path>
      </g>
      <text
        x="8"
        y="8"
        textAnchor="middle"
        dominantBaseline="middle"
        fill="#90EE90"
        fontSize="12"
        transform="translate(8.5, 20)"
      >
        Yes!
      </text>
    </g>
  </svg>;
}
