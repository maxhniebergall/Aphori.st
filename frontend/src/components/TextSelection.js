/*
 * Requirements:
 * - React component for text selection UI
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
import { getSelectionRange, findTextNodeAtPoint, getSelectedText, isValidSelection } from '../utils/selectionUtils';
import './TextSelection.css';
import debounce from 'lodash/debounce';

const TextSelection = ({ children, parentNodeId, postRootId }) => {
    const { state, dispatch } = useStoryTree();
    const containerRef = useRef(null);
    const activeHandle = useRef(null); // 'start' | 'end' | null (no active handle)
    const initialClickPos = useRef(null);
    const rafId = useRef(null);
    const isTouchDevice = useRef(false);

    // Handle initial text selection
    const handleMouseTouchDownInTextArea = (event) => {
        console.log('handleMouseTouchDownInTextArea triggered', {
            type: event.type,
            parentNodeId,
            postRootId,
            containerRef: containerRef.current,
            currentSelection: state.selection,
        });

        event.stopPropagation();
        event.preventDefault(); // Prevent text selection

        // Add a flag to prevent duplicate handling
        if (event.type === 'touchstart') {
            event.preventDefault(); // Prevent mouse events from firing
        }

        // If mouse down in a different node, clear the selection
        if (state.selection.parentNodeId != null && state.selection.parentNodeId !== parentNodeId) {
            console.log('handleMouseTouchDownInTextArea clearing selection', {
                parentNodeId,
                currentSelection: state.selection
            });
            dispatch({
                type: 'CLEAR_SELECTION'
            });
        }

        // If selection already started, do nothing, new selections will be handled by the handleAdjustSelection function
        if (state.selection.startOffset !== null) {
            console.log('handleMouseTouchDownInTextArea selection already started');
            return;
        }

        initialClickPos.current = {
            x: event.touches ? event.touches[0].clientX : event.clientX,
            y: event.touches ? event.touches[0].clientY : event.clientY
        };

        const textNodeInfo = findTextNodeAtPoint(containerRef.current, initialClickPos.current.x, initialClickPos.current.y);
        console.log('handleMouseTouchDownInTextArea Found text node:', textNodeInfo);
        
        // Only proceed if we found a valid text node
        if (textNodeInfo) {
            const newSelection = {
                sourcePostId: postRootId,
                startOffset: textNodeInfo.offset,
                endOffset: null,
                selectedText: null,
                parentNodeId: parentNodeId
            };

            dispatch({
                type: 'SET_SELECTION',
                payload: newSelection
            });

            console.log('handleMouseTouchDownInTextArea finished', {
                type: event.type,
                parentNodeId,
                postRootId,
                currentSelection: newSelection
            });

            activeHandle.current = 'end';
            document.addEventListener('touchmove', handleInitialDragForSelection, { passive: false });
            document.addEventListener('touchend', handleEndDragForInitialSelection, { passive: false });
            document.addEventListener('mousemove', handleInitialDragForSelection);
            document.addEventListener('mouseup', handleEndDragForInitialSelection);
        }
    };

    // 1. Create debounced function outside useCallback
    const debouncedHandleInitialDrag = useCallback(
        (event) => {
            console.log('handleDrag triggered', {
                type: event.type,
                activeHandle: activeHandle.current,
                currentSelection: state.selection
            });

            event.preventDefault();
            event.stopPropagation();

            // Cancel any pending animation frame
            if (rafId.current) {
                cancelAnimationFrame(rafId.current);
            }

            // Schedule the next update
            rafId.current = requestAnimationFrame(() => {
                const currentPos = {
                    x: event.touches ? event.touches[0].clientX : event.clientX,
                    y: event.touches ? event.touches[0].clientY : event.clientY
                };

                const range = getSelectionRange(containerRef.current, currentPos, activeHandle.current);
                if (!range) return;

                const text = containerRef.current.textContent;
                let newStart = state.selection.startOffset;
                let newEnd = state.selection.endOffset;

                if (activeHandle.current === 'start' && range.start !== null) {
                    newStart = Math.min(Math.max(0, range.start), state.selection.endOffset - 1);
                } else if (activeHandle.current === 'end' && range.end !== null) {
                    newEnd = Math.max(Math.min(text.length, range.end), state.selection.startOffset + 1);
                }

                console.log('handleDrag Selection range update:', {
                    newStart,
                    newEnd,
                    isValid: isValidSelection(newStart, newEnd, text.length)
                });

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
            });
        },
        [dispatch, state.selection, containerRef]
    );

    // 2. Create the debounced version outside the component
    const handleInitialDragForSelection = useCallback((event) => {
        debounce(debouncedHandleInitialDrag, 16)(event);
    }, [debouncedHandleInitialDrag]);

    const handleEndDragForInitialSelection = useCallback((event) => {
        console.log('handleEndDragForInitialSelection triggered', {
            type: event.type,
            finalSelection: state.selection
        });

        event.preventDefault();
        event.stopPropagation();

        // Clean up ALL listeners regardless of event type
        document.removeEventListener('touchmove', handleInitialDragForSelection);
        document.removeEventListener('touchend', handleEndDragForInitialSelection);
        document.removeEventListener('mousemove', handleInitialDragForSelection);
        document.removeEventListener('mouseup', handleEndDragForInitialSelection);

        // If mouse up in a different node, clear the selection
        if (state.selection.parentNodeId !== parentNodeId) {
            console.log('handleEndDragForInitialSelection clearing selection', {
                parentNodeId,
                currentSelection: state.selection
            });
            dispatch({
                type: 'CLEAR_SELECTION'
            });
            return;
        }

        const finalClickPos = {
            x: event.touches ? (event.touches[0]?.clientX || event.changedTouches[0]?.clientX) : event.clientX,
            y: event.touches ? (event.touches[0]?.clientY || event.changedTouches[0]?.clientY) : event.clientY
        };

        const textNodeInfo = findTextNodeAtPoint(containerRef.current, finalClickPos.x, finalClickPos.y);
        console.log('handleEndDragForInitialSelection Found text node:', textNodeInfo);

        dispatch({
            type: 'SET_SELECTION',
            payload: {
                sourcePostId: postRootId,
                startOffset: state.selection.startOffset,
                endOffset: textNodeInfo.offset,
                selectedText: getSelectedText(containerRef.current, state.selection.startOffset, textNodeInfo.offset),
                parentNodeId: parentNodeId
            }
        });
        
        activeHandle.current = null;

        if (rafId.current) {
            cancelAnimationFrame(rafId.current);
            rafId.current = null;
        }

        console.log('handleEndDragForInitialSelection finished', {
            type: event.type,
            finalSelection: state.selection
        });
    }, [handleInitialDragForSelection, dispatch, parentNodeId, postRootId, state.selection]);

    // 3. Clean up both the wrapper and debounced function
    useEffect(() => {
        return () => {
            document.removeEventListener('mousemove', handleInitialDragForSelection);
            document.removeEventListener('mouseup', handleEndDragForInitialSelection);
            document.removeEventListener('touchmove', handleInitialDragForSelection);
            document.removeEventListener('touchend', handleEndDragForInitialSelection);

            if (rafId.current) {
                cancelAnimationFrame(rafId.current);
            }
        };
    }, [handleInitialDragForSelection, handleEndDragForInitialSelection]);

    useEffect(() => {
        isTouchDevice.current = 'ontouchstart' in window ||
            navigator.maxTouchPoints > 0;
    }, []);

    const handleAdjustSelection = (event, handle) => {
        console.log('handleAdjustSelection triggered', {
            type: event.type,
            handle,
            currentSelection: state.selection
        });

        activeHandle.current = handle;
        // document.addEventListener('mousemove', handleDrag);
        // document.addEventListener('mouseup', handleEndDrag);
        // document.addEventListener('touchmove', handleDrag);
        // document.addEventListener('touchend', handleEndDrag);
    };

    const renderContent = () => {
        console.log('renderContent called', {
            hasActiveSelection: state.selection.active,
            matchingParentNode: state.selection.sourcePostId === parentNodeId,
            selectionState: state.selection
        });

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
                    <div
                        className={`selection-handle start-handle ${isTouchDevice.current ? 'touch-handle' : ''
                            }`}
                        style={{
                            left: 0,
                            top: '50%',
                            willChange: 'transform',
                            transform: 'translate(-50%, -50%)',
                            touchAction: 'none',
                            width: isTouchDevice.current ? '24px' : '12px',
                            height: isTouchDevice.current ? '24px' : '12px',
                        }}
                        onMouseDown={(e) => handleAdjustSelection(e, 'start')}
                        onTouchStart={(e) => handleAdjustSelection(e, 'start')}
                    />
                    <div
                        className={`selection-handle end-handle ${isTouchDevice.current ? 'touch-handle' : ''
                            }`}
                        style={{
                            right: 0,
                            top: '50%',
                            willChange: 'transform',
                            transform: 'translate(50%, -50%)',
                            touchAction: 'none',
                            width: isTouchDevice.current ? '24px' : '12px',
                            height: isTouchDevice.current ? '24px' : '12px',
                        }}
                        onMouseDown={(e) => handleAdjustSelection(e, 'end')}
                        onTouchStart={(e) => handleAdjustSelection(e, 'end')}
                    />
                </span>
                {text.substring(endOffset)}
            </>
        );
    };

    return (
        <div
            ref={containerRef}
            onMouseDown={handleMouseTouchDownInTextArea}
            className="selection-container"
        >
            {renderContent()}
        </div>
    );
};

export default TextSelection; 