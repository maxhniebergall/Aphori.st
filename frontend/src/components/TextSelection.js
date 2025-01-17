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

import React, { useRef, useEffect } from 'react';
import { useStoryTree } from '../context/StoryTreeContext';
import { findTextNodeAtPoint, getSelectedText, isValidSelection } from '../utils/selectionUtils';
import './TextSelection.css';

const TextSelection = ({ children, parentNodeId, postRootId }) => {
    const { state, dispatch } = useStoryTree();
    const containerRef = useRef(null);
    const activeHandle = useRef(null); // 'start' | 'end' | null (no active handle)
    const initialClickPos = useRef(null);
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

    const getEventCoordinates = (event) => ({
        x: event.type === 'touchstart' ? event.touches[0].clientX : event.clientX,
        y: event.type === 'touchstart' ? event.touches[0].clientY : event.clientY
    });

    useEffect(() => {
        isTouchDevice.current = 'ontouchstart' in window ||
            navigator.maxTouchPoints > 0;
    }, []);

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

    function handleSelectionStart(textNodeInfo) {
        const newSelection = {
            sourcePostId: postRootId,
            startOffset: textNodeInfo.offset,
            endOffset: null,
            selectedText: null,
            parentNodeId: parentNodeId
        };

        dispatch({ type: 'SET_SELECTION', payload: newSelection });
        activeHandle.current = 'end';
    };

    function handleMouseTouchDownInTextArea(event) {
        const isTouch = handleTouchSpecificBehavior(event);

        // Clear selection if in different node
        if (state.selection.parentNodeId != null && state.selection.parentNodeId !== parentNodeId) {
            console.log('handleMouseTouchDownInTextArea clearing selection');
            dispatch({ type: 'CLEAR_SELECTION' });
        }

        // Exit if selection already started
        if (state.selection.startOffset !== null) {
            console.log('handleMouseTouchDownInTextArea selection already started');
            return;
        }

        containerRef.current = event.target;

        initialClickPos.current = getEventCoordinates(event);
        const textNodeInfo = findTextNodeAtPoint(
            containerRef.current,
            initialClickPos.current.x,
            initialClickPos.current.y
        );

        if (textNodeInfo) {
            console.log('handleMouseTouchDownInTextArea text node found');
            handleSelectionStart(textNodeInfo);
            attachEventListeners(isTouch);
        } else {
            console.log('handleMouseTouchDownInTextArea no text node found');
            cleanUpSelectionForEnd();
        }
    };

    function handleDragEnd(event) {
        if (event.type === 'touchend') {
            handleTouchSpecificBehavior(event);
        }

        const finalPos = {
            x: event.type === 'touchend' ? 
                (event.changedTouches[0]?.clientX) : 
                event.clientX,
            y: event.type === 'touchend' ? 
                (event.changedTouches[0]?.clientY) : 
                event.clientY
        };

        if (!containerRef.current) {
            cleanUpSelectionForEnd();
            return;
        }

        const textNodeInfo = findTextNodeAtPoint(containerRef.current, finalPos.x, finalPos.y);
        if (!textNodeInfo) {
            cleanUpSelectionForEnd();
            return;
        }

        finalizeSelection(textNodeInfo.offset);
        cleanUpSelectionForEnd();

        if (rafId.current) {
            cancelAnimationFrame(rafId.current);
            rafId.current = null;
        }
    };

    function handleInitialDrag(event) {
        if (event.type === 'touchmove') {
            handleTouchSpecificBehavior(event);
            }

            const currentPos = getEventCoordinates(event);
            
            if (!containerRef.current) {
                cleanUpSelectionForEnd();
                return;
            }

            // Check container bounds
            const containerRect = containerRef.current.getBoundingClientRect();
            const isWithinContainer = (
                currentPos.x >= containerRect.left &&
                currentPos.x <= containerRect.right &&
                currentPos.y >= containerRect.top &&
                currentPos.y <= containerRect.bottom
            );

            if (!isWithinContainer) {
                cleanUpSelectionForEnd();
                return;
            }

            const textNodeInfo = findTextNodeAtPoint(containerRef.current, currentPos.x, currentPos.y);
            if (!textNodeInfo) {
                cleanUpSelectionForEnd();
                return;
            }

            updateSelectionRange(textNodeInfo.offset);
        };

    function cleanUpSelectionForEnd() {
        activeHandle.current = null;
        if (containerRef.current) {
            containerRef.current.removeEventListener('mousemove', handleInitialDrag);
            containerRef.current.removeEventListener('mouseup', handleDragEnd);
            containerRef.current.removeEventListener('touchmove', handleInitialDrag);
            containerRef.current.removeEventListener('touchend', handleDragEnd);
        }

        if (!isValidSelection(state?.selection?.startOffset, state?.selection?.endOffset, state?.selection?.text?.length)) {
            dispatch({
                type: 'CLEAR_SELECTION'
            });
        }
    }

    function finalizeSelection(finalOffset) {
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
                    parentNodeId: parentNodeId
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

    function attachEventListeners(isTouch) {
        if (isTouch) {
            containerRef.current.addEventListener('touchmove', handleInitialDrag, { passive: false });
            containerRef.current.addEventListener('touchend', handleDragEnd, { passive: false });
        } else {
            containerRef.current.addEventListener('mousemove', handleInitialDrag);
            containerRef.current.addEventListener('mouseup', handleDragEnd);
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


    const renderContent = () => {
        if (!state.selection.startOffset || state.selection.sourcePostId !== parentNodeId) {
            return children;
        }

        const text = children.toString();
        const { startOffset, endOffset } = state.selection;

        return (
            <>
                {text.substring(0, startOffset)}
                <span className="selection-highlight">
                    {text.substring(startOffset, endOffset)}
                    {renderSelectionHandle('start')}
                    {renderSelectionHandle('end')}
                </span>
                {text.substring(endOffset)}
            </>
        );
    };

    return (
        <div
            ref={containerRef}
            onMouseDown={handleMouseTouchDownInTextArea}
            // onMouseMove={(e) => handleInitialDrag(e)}
            // onMouseUp={(e) => handleEndDragForInitialSelection(e)}
            // onTouchMove={(e) => handleInitialDrag(e)}
            // onTouchEnd={(e) => handleEndDragForInitialSelection(e)}
            className="selection-container"
        >
            {renderContent()}
        </div>
    );
};

export default TextSelection; 