/*
 * Requirements:
 * - Click/tap word selection functionality
 * - Drag selection with mouse/touch events
 * - Selection highlight rendering
 * - Drag handles for selection adjustment
 * - Selection persistence via context
 * - Selection validation and boundary checks
 * - Mouse and touch event handling
 * - Integration with StoryTree context
 * - Support for hybrid touch/mouse devices
 * - Prevention of duplicate events on touch devices
 * - Non-passive touch event handling for preventDefault support
 */

import React, { useRef, useEffect, useCallback } from 'react';
import { useStoryTree } from '../context/StoryTreeContext';
import { findNodeTextFromEvent, getSelectedText, isValidSelection, isWithinContainerBounds, getSelectionRange } from '../utils/selectionUtils';
import './TextSelection.css';

const TextSelection = ({ children, parentNodeId, postRootId }) => {
    const { state, dispatch } = useStoryTree();
    const containerRef = useRef(null);

    const rafId = useRef(null);
    const isTouchDevice = useRef(false);


    const handleTouchSpecificBehavior = (event) => {
        if (event.type === 'touchstart') {
            event.preventDefault();
            event.stopPropagation();
            isTouchDevice.current = true;
            return true;
        }
        return false;
    };

    useEffect(() => {
        isTouchDevice.current = 'ontouchstart' in window ||
            navigator.maxTouchPoints > 0;
    }, []);

    async function handleMouseTouchDownInTextArea(event) {
        handleTouchSpecificBehavior(event);
        event.preventDefault();
        event.stopPropagation();
        dispatch({ type: 'CLEAR_SELECTION' });

        const selectionRange = getSelectionRange(containerRef.current, event, 'start');

        if (selectionRange && selectionRange.start !== null) {
            console.log('handleMouseTouchDownInTextArea text node found', {containerRef: containerRef.current});
            await handleSelectionStart(selectionRange.start);
        } else {
            console.log('handleMouseTouchDownInTextArea no text node found');
            dispatch({ type: 'CLEAR_SELECTION' });
        }
    };

    // const handleAdjustSelection = (event, handle) => { TODO - implement handle adjustment
    //     console.log('handleAdjustSelection triggered', {
    //         type: event.type,
    //         handle,
    //         currentSelection: state.selection
    //     });

    //     activeHandle.current = handle;
    //     containerRef.current.addEventListener('mousemove', handleDrag);
    //     containerRef.current.addEventListener('mouseup', handleEndDrag);
    //     containerRef.current.addEventListener('touchmove', handleDrag);
    //     containerRef.current.addEventListener('touchend', handleEndDrag);
    // };

    async function handleSelectionStart(startOffset) {
        const newSelection = {
            sourcePostId: postRootId,
            startOffset,
            endOffset: null,
            selectedText: null,
            parentNodeId: parentNodeId,
            activeHandle: 'end',
            isDragging: true
        };

        dispatch({ type: 'SET_SELECTION', payload: newSelection });
        console.log('handleSelectionStart', {
            activeHandle: state.selection.activeHandle,
            isDragging: state.selection.isDragging,
            newSelection,
            currentSelection: state.selection
        });
    };

    function handleDragEnd(event) {
        if (!state.selection.isDragging || state.selection.activeHandle !== 'end') {
            return;
        }

        if (event.type === 'touchend') {
            handleTouchSpecificBehavior(event);
        }

        const textNodeInfo = findNodeTextFromEvent(containerRef.current, event);
        if (!textNodeInfo) {
            console.log('drag ended');
            dispatch({ type: 'CLEAR_SELECTION' });
            return;
        }
        
        finalizeSelection(textNodeInfo.offset);

        if (rafId.current) {
            cancelAnimationFrame(rafId.current);
            rafId.current = null;
        }
    };

    function handleDragAnimation(event) {
        if (!state.selection.isDragging || state.selection.activeHandle !== 'end') {
            return;
        }

        if (event.type === 'touchmove') {
            handleTouchSpecificBehavior(event);
        }

        if (!isWithinContainerBounds(containerRef.current, event)) {
            dispatch({ type: 'CLEAR_SELECTION' });
            return;
        }

        const selectionRange = getSelectionRange(containerRef.current, event, 'end');
        if (!selectionRange || selectionRange.end === null) {
            dispatch({ type: 'CLEAR_SELECTION' });
            return; 
        }
        
        updateSelectionRange(selectionRange.end);
    };

    function finalizeSelection(finalOffset) {
        console.log('finalizeSelection triggered', {
            finalOffset,
            currentSelection: state.selection
        });
        const text = containerRef.current.textContent;
        const boundedOffset = Math.max(Math.min(text.length, finalOffset), 0);

        if (isValidSelection(state.selection.startOffset, boundedOffset, text.length)) {
            dispatch({
                type: 'SET_SELECTION',
                payload: {
                    sourcePostId: postRootId,
                    startOffset: state.selection.startOffset,
                    endOffset: boundedOffset,
                    selectedText: getSelectedText(containerRef.current, state.selection.startOffset, boundedOffset),
                    parentNodeId: parentNodeId,
                    isDragging: false,
                    activeHandle: null
                }
            });
        }
    }

    function updateSelectionRange(newEndOffset) {
        const text = containerRef.current.textContent;
        const newEnd = Math.max(Math.min(text.length, newEndOffset), 0);

        if (isValidSelection(state.selection.startOffset, newEnd, text.length)) {
            dispatch({
                type: 'UPDATE_SELECTION_RANGE',
                payload: {
                    startOffset: state.selection.startOffset,
                    endOffset: newEnd,
                    selectedText: getSelectedText(containerRef.current, state.selection.startOffset, newEnd)
                }
            });
        }
    };

    const renderSelectionHandle = (position) => {
        const isStart = position === 'start';
        return (
            <div
                className={`selection-handle ${position}-handle ${isTouchDevice.current ? 'touch-handle' : ''}`}
                style={{
                    [isStart ? 'left' : 'right']: 0,
                    top: '50%',
                    willChange: 'transform',
                    transform: `translate(${isStart ? '-50%' : '50%'}, -50%)`,
                    touchAction: 'none',
                    width: isTouchDevice.current ? '24px' : '12px',
                    height: isTouchDevice.current ? '24px' : '12px',
                }}
                // TODO: Implement handle adjustment
                // onMouseDown={(e) => handleAdjustSelection(e, position)}
                // onTouchStart={(e) => handleAdjustSelection(e, position)}
            />
        );
    };


    const renderContent = useCallback(() => {
        const text = children.toString();
        const { startOffset, endOffset } = state.selection;
        if (!isValidSelection(startOffset, endOffset, text.length)) {
            return (
                text
            );
        }

        return (
            <>
                    {text.substring(0, startOffset)}
                    <span className="selection-highlight">
                        {renderSelectionHandle('start')}
                        {text.substring(startOffset, endOffset)}
                        {renderSelectionHandle('end')}
                    </span>
                    {text.substring(endOffset)}
            </>
        );
    }, [state.selection, children]);

    return (
        <div
            ref={containerRef}
            onMouseDown={handleMouseTouchDownInTextArea}
            onMouseMove={handleDragAnimation}
            onTouchMove={handleDragAnimation}
            onMouseUp={handleDragEnd}
            onTouchEnd={handleDragEnd}
            className="selection-container"
        >
            {renderContent()}
        </div>
    );
};

export default TextSelection; 