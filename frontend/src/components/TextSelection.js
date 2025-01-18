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
 *
 */

import React, { useRef } from 'react';
import { getCurrentOffset } from '../utils/selectionUtils';
import './TextSelection.css';
import { throttle, debounce } from 'lodash';

// Create throttled animation loop outside component to prevent recreation
const throttledAnimationLoop = throttle((event, containerRef, startOffset) => {
    console.log("animationLoop");
    const endOffset = getCurrentOffset(containerRef.current, event);
    // use DOM manupipulation of CSS to highlight the text between the start and end offsets
    highlightText(containerRef.current, startOffset, endOffset);

}, 16); // 60fps = ~16ms throttle

function highlightText(element, startOffset, endOffset) {
    // Remove any existing highlights first
    const existingHighlights = element.querySelectorAll('span[style*="background-color: yellow"]');
    existingHighlights.forEach(highlight => {
        const parent = highlight.parentNode;
        parent.replaceChild(document.createTextNode(highlight.textContent), highlight);
        parent.normalize(); // Merge adjacent text nodes
    });

    // Find the text node and offset positions
    const findNodeAndOffset = (offset) => {
        let currentOffset = 0;
        const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
        
        while (walker.nextNode()) {
            const node = walker.currentNode;
            const length = node.textContent.length;
            
            if (currentOffset + length > offset) {
                return {
                    node,
                    offset: offset - currentOffset
                };
            }
            currentOffset += length;
        }
        return null;
    };

    // Get start and end positions
    const start = findNodeAndOffset(Math.min(startOffset, endOffset));
    const end = findNodeAndOffset(Math.max(startOffset, endOffset));

    if (!start || !end) return;

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

const TextSelection = ({ children, onSelectionCompleted }) => {
    const containerRef = useRef(null);
    const boundThrottledAnimationRef = useRef(null); // Store the bound function
    let initialOffset = null;
    let finalOffset = null;

    // Create debounced version of onSelectionCompleted
    const debouncedSelectionCallback = useRef(
        debounce((selection) => {
            if (selection.start > selection.end) {
                onSelectionCompleted({start: selection.end, end: selection.start});
            } else {
                onSelectionCompleted(selection);
            }
        }, 250)
    ).current;

    const animateSelection = (event) => {
        console.log("animateSelection");
        event.preventDefault();
        event.stopPropagation();

        initialOffset = getCurrentOffset(containerRef.current, event);
        console.log("initialOffset", initialOffset);
        
        // Create the bound function once and store it
        boundThrottledAnimationRef.current = (e) => throttledAnimationLoop(e, containerRef, initialOffset);
        
        containerRef.current.addEventListener('mousemove', boundThrottledAnimationRef.current);
        containerRef.current.addEventListener('touchmove', boundThrottledAnimationRef.current);
    }   

    const endAnimationLoop = (event) => {
        console.log("endAnimationLoop");
        event.preventDefault();
        event.stopPropagation();
        
        // Use the stored reference to remove listeners
        containerRef.current.removeEventListener('mousemove', boundThrottledAnimationRef.current);
        containerRef.current.removeEventListener('touchmove', boundThrottledAnimationRef.current);
        
        finalOffset = getCurrentOffset(containerRef.current, event);
        console.log("finalOffset", finalOffset);
        const selection = {
            start: initialOffset,
            end: finalOffset
        };
        return selection;
    }

    const handleSelectionCompleted = (event) => {
        console.log("handleSelectionCompleted");

        const selection = endAnimationLoop(event);
        debouncedSelectionCallback(selection);
    }
  
    return (
        <div
            ref={containerRef}
            className="selection-container"
            style={{ userSelect: 'none', WebkitUserSelect: 'none' }}
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