/*
 * Requirements:
 * - React component for text selection UI
 * - CSS modules for styling
 * - Drag handle implementation
 * - Selection highlight rendering
 * - Mouse and touch event handling
 */

import React, { useRef, useEffect, useCallback } from 'react';
import { useStoryTree } from '../context/StoryTreeContext';
import { getSelectionRange, getWordBoundaries, getSelectedText, isValidSelection } from '../utils/selectionUtils';
import './TextSelection.css';

const TextSelection = ({ children, postId }) => {
  const { state, dispatch } = useStoryTree();
  const containerRef = useRef(null);
  const isDragging = useRef(false);
  const activeHandle = useRef(null);

  const handleClick = (event) => {
    if (!state.selection.active) {
      const text = containerRef.current.textContent;
      const range = getSelectionRange(containerRef.current, event);
      
      if (range) {
        const { start, end } = getWordBoundaries(text, range.start);
        const selectedText = getSelectedText(containerRef.current, start, end);
        
        dispatch({
          type: 'SET_SELECTION',
          payload: {
            sourcePostId: postId,
            startOffset: start,
            endOffset: end,
            selectedText,
            replyId: null // Will be set when reply is initiated
          }
        });
      }
    }
  };

  const handleDragStart = (event, handle) => {
    isDragging.current = true;
    activeHandle.current = handle;
    event.stopPropagation();
  };

  const handleDragMove = useCallback((event) => {
    if (isDragging.current && containerRef.current) {
      const range = getSelectionRange(containerRef.current, event);
      if (!range) return;

      const text = containerRef.current.textContent;
      let newStart = state.selection.startOffset;
      let newEnd = state.selection.endOffset;

      if (activeHandle.current === 'start') {
        newStart = range.start;
      } else if (activeHandle.current === 'end') {
        newEnd = range.end;
      }

      if (isValidSelection(newStart, newEnd, text.length)) {
        dispatch({
          type: 'UPDATE_SELECTION_RANGE',
          payload: {
            startOffset: newStart,
            endOffset: newEnd,
            selectedText: getSelectedText(containerRef.current, newStart, newEnd)
          }
        });
      }
    }
  }, [dispatch, state.selection.startOffset, state.selection.endOffset]);

  const handleDragEnd = () => {
    isDragging.current = false;
    activeHandle.current = null;
  };

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    container.addEventListener('mousemove', handleDragMove);
    container.addEventListener('touchmove', handleDragMove);
    document.addEventListener('mouseup', handleDragEnd);
    document.addEventListener('touchend', handleDragEnd);

    return () => {
      container.removeEventListener('mousemove', handleDragMove);
      container.removeEventListener('touchmove', handleDragMove);
      document.removeEventListener('mouseup', handleDragEnd);
      document.removeEventListener('touchend', handleDragEnd);
    };
  }, [handleDragMove]);

  const renderContent = () => {
    if (!state.selection.active || state.selection.sourcePostId !== postId) {
      return children;
    }

    const text = children.toString();
    const { startOffset, endOffset } = state.selection;

    return (
      <>
        {text.substring(0, startOffset)}
        <span className="selection-highlight">
          {text.substring(startOffset, endOffset)}
          <div
            className="selection-handle"
            style={{ left: 0, top: '50%' }}
            onMouseDown={(e) => handleDragStart(e, 'start')}
            onTouchStart={(e) => handleDragStart(e, 'start')}
          />
          <div
            className="selection-handle"
            style={{ right: 0, top: '50%' }}
            onMouseDown={(e) => handleDragStart(e, 'end')}
            onTouchStart={(e) => handleDragStart(e, 'end')}
          />
        </span>
        {text.substring(endOffset)}
      </>
    );
  };

  return (
    <div
      ref={containerRef}
      onClick={handleClick}
      className="selection-container"
    >
      {renderContent()}
    </div>
  );
};

export default TextSelection; 