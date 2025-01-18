/*
 * Requirements:
 * - Browser native text selection
 * - Selection persistence via DOM manipulation
 * - Selection validation and boundary checks
 * - Support for hybrid touch/mouse devices
 * - Smooth selection animation without re-renders
 */

import React, { useRef, useEffect, useCallback } from 'react';
import './TextSelection.css';

const TextSelection = ({ children, parentNodeId, postRootId, onSelectionChange }) => {
    const containerRef = useRef(null);
    const highlightRef = useRef(null);
    const selectionStateRef = useRef({
        sourcePostId: null,
        startOffset: null,
        endOffset: null,
        selectedText: null
    });

    const updateHighlight = useCallback((startOffset, endOffset) => {
        if (!containerRef.current) return;

        // Remove existing highlight if any
        if (highlightRef.current) {
            highlightRef.current.remove();
            highlightRef.current = null;
        }

        if (!startOffset || !endOffset || startOffset === endOffset) return;

        const range = document.createRange();
        let currentNode = containerRef.current.firstChild;
        let currentOffset = 0;

        // Find start node and offset
        while (currentNode && currentOffset + currentNode.textContent.length < startOffset) {
            currentOffset += currentNode.textContent.length;
            currentNode = currentNode.nextSibling;
        }

        if (currentNode) {
            range.setStart(currentNode, startOffset - currentOffset);

            // Find end node and offset
            while (currentNode && currentOffset + currentNode.textContent.length < endOffset) {
                currentOffset += currentNode.textContent.length;
                currentNode = currentNode.nextSibling;
            }

            if (currentNode) {
                range.setEnd(currentNode, endOffset - currentOffset);
                
                const span = document.createElement('span');
                span.className = 'selection-highlight';
                range.surroundContents(span);
                highlightRef.current = span;
            }
        }
    }, []);

    const handleSelectionChange = useCallback(() => {
        if (!containerRef.current) return;

        const selection = window.getSelection();
        if (!selection || !selection.rangeCount) {
            if (selectionStateRef.current.sourcePostId === postRootId) {
                selectionStateRef.current = {
                    sourcePostId: null,
                    startOffset: null,
                    endOffset: null,
                    selectedText: null
                };
                onSelectionChange?.(null);
            }
            return;
        }

        const range = selection.getRangeAt(0);
        const container = containerRef.current;

        if (!range.commonAncestorContainer || !container.contains(range.commonAncestorContainer)) {
            if (selectionStateRef.current.sourcePostId === postRootId) {
                selectionStateRef.current = {
                    sourcePostId: null,
                    startOffset: null,
                    endOffset: null,
                    selectedText: null
                };
                onSelectionChange?.(null);
            }
            return;
        }

        try {
            const tempRange = document.createRange();
            tempRange.setStart(container, 0);
            tempRange.setEnd(range.startContainer, range.startOffset);
            const startOffset = tempRange.toString().length;

            tempRange.setEnd(range.endContainer, range.endOffset);
            const endOffset = tempRange.toString().length;

            if (startOffset === endOffset) return;

            const selectionData = {
                sourcePostId: postRootId,
                startOffset,
                endOffset,
                selectedText: range.toString(),
                parentNodeId
            };

            selectionStateRef.current = selectionData;
            onSelectionChange?.(selectionData);
            updateHighlight(startOffset, endOffset);
        } catch (error) {
            console.error('Error calculating selection:', error);
            selectionStateRef.current = {
                sourcePostId: null,
                startOffset: null,
                endOffset: null,
                selectedText: null
            };
            onSelectionChange?.(null);
        }
    }, [postRootId, parentNodeId, updateHighlight, onSelectionChange]);

    useEffect(() => {
        if (containerRef.current) {
            document.addEventListener('selectionchange', handleSelectionChange);
            return () => {
                document.removeEventListener('selectionchange', handleSelectionChange);
                if (highlightRef.current) {
                    highlightRef.current.remove();
                }
            };
        }
    }, [handleSelectionChange]);

    return (
        <div
            ref={containerRef}
            className="selection-container"
            style={{ userSelect: 'text', WebkitUserSelect: 'text' }}
        >
            {children}
        </div>
    );
};

export default TextSelection; 