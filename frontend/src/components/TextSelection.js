/*
 * Requirements:
 * - React component for text selection UI
 * - Styled components for selection styling
 * - Drag handle implementation
 * - Selection highlight rendering
 * - Mouse and touch event handling
 */

import React, { useRef, useEffect } from 'react';
import styled from 'styled-components';
import { useStoryTree } from '../context/StoryTreeContext';
import { getSelectionRange, getWordBoundaries, getSelectedText, isValidSelection } from '../utils/selectionUtils';

const SelectionContainer = styled.div`
  position: relative;
  display: inline;
`;

const SelectionHighlight = styled.span`
  background-color: rgba(255, 255, 0, 0.3);
  position: relative;
`;

const SelectionHandle = styled.div`
  width: 8px;
  height: 8px;
  background-color: #007AFF;
  border-radius: 50%;
  position: absolute;
  transform: translate(-50%, -50%);
  cursor: ew-resize;
  touch-action: none;
`;

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

  const handleDragMove = (event) => {
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
  };

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
  }, [state.selection]);

  const renderContent = () => {
    if (!state.selection.active || state.selection.sourcePostId !== postId) {
      return children;
    }

    const text = children.toString();
    const { startOffset, endOffset } = state.selection;

    return (
      <>
        {text.substring(0, startOffset)}
        <SelectionHighlight>
          {text.substring(startOffset, endOffset)}
          <SelectionHandle
            style={{ left: 0, top: '50%' }}
            onMouseDown={(e) => handleDragStart(e, 'start')}
            onTouchStart={(e) => handleDragStart(e, 'start')}
          />
          <SelectionHandle
            style={{ right: 0, top: '50%' }}
            onMouseDown={(e) => handleDragStart(e, 'end')}
            onTouchStart={(e) => handleDragStart(e, 'end')}
          />
        </SelectionHighlight>
        {text.substring(endOffset)}
      </>
    );
  };

  return (
    <SelectionContainer
      ref={containerRef}
      onClick={handleClick}
    >
      {renderContent()}
    </SelectionContainer>
  );
};

export default TextSelection; 