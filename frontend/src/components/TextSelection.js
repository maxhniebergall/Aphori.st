/*
 * Requirements:
 * - Custom text selection component
 * - Selection animation via DOM manipulation
 * - Selection animation must use throttling to prevent performance issues
 * - Smooth selection animation without re-renders
 * - Rerenders must be avoided during animation
 * - Selection validation and boundary checks after selection finishes
 * - Selection persistence with debouncing in react state
 * - Support for hybrid touch/mouse devices
 * - User can select text forward or backward
 * - Custom handles for adjusting selection
 * - Mouse state tracking to prevent stuck animations
 */

import React, { useRef, useEffect } from 'react';
import { getCurrentOffset, getWordBoundaries } from '../utils/selectionUtils';
import './TextSelection.css';
import { throttle, debounce } from 'lodash';
// Create throttled animation loop outside component to prevent recreation
const throttledAnimationLoop = throttle((event, containerRef, startOffset, mouseIsDownRef) => {
    // Check if mouse is still down, if not, clean up and return
    if (!mouseIsDownRef.current) {
        removeExistingHighlights(containerRef.current);
        return;
    }

    console.log("animationLoop");
    const endOffset = getCurrentOffset(containerRef.current, event);
    // use DOM manupipulation of CSS to highlight the text between the start and end offsets
    highlightText(containerRef.current, startOffset, endOffset);

}, 16); // 60fps = ~16ms throttle

function removeExistingHighlights(element) {
    const existingHighlights = element.querySelectorAll('span[style*="background-color: yellow"]');
    existingHighlights.forEach(highlight => {
        const parent = highlight.parentNode;
        parent.replaceChild(document.createTextNode(highlight.textContent), highlight);
        parent.normalize(); // Merge adjacent text nodes
    });
}

function highlightText(element, startOffset, endOffset) {
    console.log("highlightText", startOffset, endOffset);
    // Use the extracted function
    removeExistingHighlights(element);

    // Find the text node and offset positions
    const findNodeAndOffset = (offset) => {
        let currentOffset = 0;
        const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
        console.log("walker", walker);
        console.log("walker.currentNode", walker.currentNode);
        while (walker.nextNode()) {
            const node = walker.currentNode;
            const length = node.textContent.length;
            
            if (currentOffset + length >= offset) {
                return {
                    node,
                    offset: offset - currentOffset
                };
            }
            currentOffset += length;
        }
        console.log("couldn't find node");
        return null;
    };

    // Get start and end positions
    const start = findNodeAndOffset(Math.min(startOffset, endOffset));
    const end = findNodeAndOffset(Math.max(startOffset, endOffset));

    if (!start || !end) {
        console.log("couldn't find node", start, end);
        return;
    }

    // Create and set the range
    const range = document.createRange();
    range.setStart(start.node, start.offset);
    range.setEnd(end.node, end.offset);

    // Create highlight span
    const span = document.createElement('span');
    span.style.backgroundColor = 'yellow';

    try {
        range.surroundContents(span);
    } catch (e) {
        console.warn('Could not highlight selection:', e);
    }
}

const TextSelection = ({ children, onSelectionCompleted, selectAll, clearSelection}) => {
    const containerRef = useRef(null);
    const boundThrottledAnimationRef = useRef(null);
    const mouseIsDownRef = useRef(false);
    const isDraggingRef = useRef(false);
    let initialOffset = null;
    let finalOffset = null;

    const cleanupEventListeners = () => {
        console.log("Cleaning up event listeners");
        if (boundThrottledAnimationRef.current) {
            containerRef.current?.removeEventListener('mousemove', boundThrottledAnimationRef.current);
            containerRef.current?.removeEventListener('touchmove', boundThrottledAnimationRef.current, {
                capture: true
            });
            boundThrottledAnimationRef.current = null;
        }
    };

    useEffect(() => {
        console.log("TextSelection useEffect", { selectAll });
        
        // Handle selection state changes
        if (containerRef.current) {
            if (selectAll) {
                highlightText(containerRef.current, 0, containerRef.current.textContent.length);
            } else {
                removeExistingHighlights(containerRef.current);
            }
        }

        // Handle global mouse/touch events
        const handleGlobalMouseUp = () => {
            if (mouseIsDownRef.current) {
                mouseIsDownRef.current = false;
                if (isDraggingRef.current) {
                    removeExistingHighlights(containerRef.current);
                }
                cleanupEventListeners();
            }
        };

        window.addEventListener('mouseup', handleGlobalMouseUp);
        window.addEventListener('touchend', handleGlobalMouseUp);

        return () => {
            if (!selectAll) {
                window.removeEventListener('mouseup', handleGlobalMouseUp);
                window.removeEventListener('touchend', handleGlobalMouseUp);
                cleanupEventListeners();
            }
        };
    }, [children, selectAll, containerRef]);

    // Create debounced version of onSelectionCompleted
    const debouncedSelectionCallback = useRef(
        debounce((selection) => {
            if (selection.start > selection.end) {
                // If the selection is backwards, swap the start and end
                onSelectionCompleted({start: selection.end, end: selection.start});
            } else {
                onSelectionCompleted(selection);
            }
        }, 250)
    ).current;

    const handleWordSelection = (offset) => {
        if (!containerRef.current) return;
        
        const text = containerRef.current.textContent;
        const { start, end } = getWordBoundaries(text, offset);
        
        // Remove any existing highlights before adding new one
        removeExistingHighlights(containerRef.current);
        
        // Highlight the word
        highlightText(containerRef.current, start, end);
        
        // Notify parent of selection
        debouncedSelectionCallback({ start, end });
    };

    const animateSelection = (event) => {
        console.log("animateSelection");
        
        // Only prevent default for mouse events
        if (!event.type.startsWith('touch')) {
            event.preventDefault();
        }
        
        event.stopPropagation();
        mouseIsDownRef.current = true;
        isDraggingRef.current = false;
        initialOffset = getCurrentOffset(containerRef.current, event);
        
        boundThrottledAnimationRef.current = (e) => {
            // Prevent default during move to stop scrolling
            if (e.cancelable) {
                e.preventDefault();
            }
            isDraggingRef.current = true;
            throttledAnimationLoop(e, containerRef, initialOffset, mouseIsDownRef);
        };
        
        if (event.type === 'touchstart') {
            containerRef.current.addEventListener('touchmove', boundThrottledAnimationRef.current, {
                passive: false,
                capture: true
            });
        } else {
            containerRef.current.addEventListener('mousemove', boundThrottledAnimationRef.current);
        }
    }   

    const endAnimationLoop = (event) => {
        console.log("endAnimationLoop");
        event.preventDefault();
        event.stopPropagation();
        
        mouseIsDownRef.current = false;
        isDraggingRef.current = false;
        
        // Clean up event listeners
        cleanupEventListeners();
        
        finalOffset = getCurrentOffset(containerRef.current, event);
        console.log("finalOffset", finalOffset);
        const selection = {
            start: initialOffset,
            end: finalOffset
        };
        return selection;
    }

    const handleSelectionCompleted = (event) => {
        console.log("handleSelectionCompleted", { 
            mouseIsDown: mouseIsDownRef.current,
            isDragging: isDraggingRef.current,
            initialOffset
        });
        
        // Only process if mouse was down
        if (!mouseIsDownRef.current) {
            console.log("Mouse wasn't down, ignoring");
            return;
        }

        // Clean up event listeners first
        cleanupEventListeners();

        // If not dragging, handle as word selection
        if (!isDraggingRef.current && initialOffset !== null) {
            console.log("Handling as word selection");
            handleWordSelection(initialOffset);
            mouseIsDownRef.current = false;
            return;
        }

        console.log("Handling as drag selection");
        const selection = endAnimationLoop(event);
        if (selection) {
            debouncedSelectionCallback(selection);
        }
    }
  
    return (
        <div
            ref={containerRef}
            className="selection-container"
            style={{ 
                userSelect: 'none', 
                WebkitUserSelect: 'none',
                touchAction: 'none'
            }}
            onMouseDown={animateSelection}
            onTouchStart={animateSelection}
            onMouseUp={handleSelectionCompleted}
            onTouchEnd={handleSelectionCompleted}
        >
            {children}
        </div>
    );
};

export default TextSelection; 