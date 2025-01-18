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

import React, { useRef, useEffect, useCallback } from 'react';
import { getCurrentOffset } from '../utils/selectionUtils';
import './TextSelection.css';

const TextSelection = ({ children, onSelectionCompleted, completedSelection }) => {
    const containerRef = useRef(null);
    let initialOffset = null;
    let finalOffset = null;

    // TODO throttle
    const animationLoop = (event) => {
        console.log("animationLoop");

        const currentOffset = getCurrentOffset(containerRef.current, event);
        console.log("currentOffset", currentOffset);
    }

    const animateSelection = (event) => {
        console.log("animateSelection");
        event.preventDefault();
        event.stopPropagation();

        initialOffset = getCurrentOffset(containerRef.current, event);
        console.log("initialOffset", initialOffset);
        containerRef.current.addEventListener('mousemove', animationLoop);
        containerRef.current.addEventListener('touchmove', animationLoop);
    }   

    const endAnimationLoop = (event) => {
        console.log("endAnimationLoop");
        event.preventDefault();
        event.stopPropagation();
        containerRef.current.removeEventListener('mousemove', animationLoop);
        containerRef.current.removeEventListener('touchmove', animationLoop);
        finalOffset = getCurrentOffset(containerRef.current, event);
        console.log("finalOffset", finalOffset);
        const selection = {
            start: initialOffset,
            end: finalOffset
        };
        return selection;
    }

    // TODO debounce
    const handleSelectionCompleted = (event) => {
        console.log("handleSelectionCompleted");

        const selection = endAnimationLoop(event);
        onSelectionCompleted(selection);
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