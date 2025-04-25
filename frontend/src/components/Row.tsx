/**
 * Unified Row Component
 * This file contains a single component that handles all row functionality:
 * - Dynamic height management with resize observation
 * - StoryTreeLevel rendering with navigation callbacks
 * - Virtualization support for react-window
 */

import React, { useRef, useMemo, memo, useCallback, useEffect } from 'react';
import { ListChildComponentProps } from 'react-window';
import useDynamicRowHeight from '../hooks/useDynamicRowHeight';
import StoryTreeLevelComponent from './StoryTreeLevel';
import { StoryTreeLevel, StoryTreeNode } from '../types/types';
import { 
  getSelectedQuote, 
  getSiblings, 
  getSelectedNodeHelper, 
  isMidLevel
} from '../utils/levelDataHelpers';
import storyTreeOperator from '../operators/StoryTreeOperator';

// Row Component Props - combines all previous component props
interface RowProps extends Omit<ListChildComponentProps, 'data'> {
  levelData: StoryTreeLevel;
  setSize: (visualHeight: number) => void;
  shouldHide: boolean;
  index: number;
}

/**
 * Unified Row component that handles all row-related functionality
 * - Dynamic height management
 * - Content rendering
 * - Style computation
 */
const Row: React.FC<RowProps> = memo(
  ({
    style, 
    levelData, 
    setSize, 
    shouldHide,
    index
  }) => {
    console.log(`Row rendering/mounting - index: ${index}`);

    // --- BEGIN: Added logging for levelData reference change at index 0 ---
    const prevLevelDataRef = useRef<StoryTreeLevel | undefined>(undefined);
    useEffect(() => {
      if (index === 0) {
        if (prevLevelDataRef.current && prevLevelDataRef.current !== levelData) {
          console.log(`Row[0]: levelData REFERENCE CHANGED between renders.`);
        } else if (!prevLevelDataRef.current) {
          console.log(`Row[0]: Initial render, storing levelData reference.`);
        } else {
          console.log(`Row[0]: levelData reference SAME between renders.`);
        }
        // Update the ref *after* the comparison
        prevLevelDataRef.current = levelData;
      }
    }, [levelData, index]); // Depend on levelData and index
    // --- END: Added logging --- 

    // Log unmount
    useEffect(() => {
      // This cleanup function runs only when the component unmounts
      return () => {
        console.log(`Row unmounting - index: ${index}`);
      };
    }, [index]);

    // Reference to the row element for measuring height
    const rowRef = useRef<HTMLDivElement>(null);

    // Use the dynamic height hook directly in the Row component
    useDynamicRowHeight({
      rowRef,
      setSize,
      shouldHide,
    });

    // Compute the final style for the row
    const computedStyle: React.CSSProperties = useMemo(() => {
      return {
        ...style,
        position: 'absolute',
        left: 0,
        right: 0,
        width: '100%',
        padding: shouldHide ? 0 : '20px',
        boxSizing: 'border-box',
        display: shouldHide ? 'none' : 'block',
        minHeight: shouldHide ? 0 : 100,
        overflow: 'visible',
        opacity: shouldHide ? 0 : 1,
        transition: 'opacity 0.2s ease-in-out'
      };
    }, [style, shouldHide]);

    // Create navigation callbacks for StoryTreeLevel
    const navigateToNextSiblingCallback = useCallback(async () => {
      if (!isMidLevel(levelData)) {
        console.warn("Navigate called on non-MidLevel:", levelData);
        return;
      }

      const selectedQuote = getSelectedQuote(levelData);
      if (!selectedQuote) {
        console.error('No selected quote found for navigation in level:', levelData);
        return;
      }

      const siblingsData = getSiblings(levelData);
      if (!siblingsData) {
        console.error('No siblings data found for navigation in level:', levelData);
        return;
      }

      const siblingsForQuote = siblingsData.levelsMap.find(
        ([quoteFromMap]) => quoteFromMap && selectedQuote && quoteFromMap.sourcePostId === selectedQuote.sourcePostId && quoteFromMap.text === selectedQuote.text && quoteFromMap.selectionRange.start === selectedQuote.selectionRange.start && quoteFromMap.selectionRange.end === selectedQuote.selectionRange.end
      );

      if (!siblingsForQuote || siblingsForQuote[1].length === 0) {
        console.error('No siblings found for the selected quote:', selectedQuote, 'in level:', levelData);
        return;
      }

      const currentSelectedNode = getSelectedNodeHelper(levelData);
      if (!currentSelectedNode) {
        console.error('No currently selected node found in level:', levelData);
        return;
      }

      const currentIndex = siblingsForQuote[1].findIndex(sibling => sibling.id === currentSelectedNode.id);

      if (currentIndex === -1) {
         console.error('Current selected node not found within its own sibling list:', currentSelectedNode, siblingsForQuote[1]);
         return;
      }

      if (currentIndex >= siblingsForQuote[1].length - 1) {
        console.log('Already at the last sibling.');
        return;
      }

      const nextSibling = siblingsForQuote[1][currentIndex + 1];
      if (!nextSibling) {
         console.error('Next sibling is unexpectedly undefined at index', currentIndex + 1, 'in', siblingsForQuote[1]);
         return;
      }

      try {
        await storyTreeOperator.setSelectedNode(nextSibling);
      } catch (error) {
        console.error("Failed to set selected node:", error);
      }

    }, [levelData]);

    const navigateToPreviousSiblingCallback = useCallback(async () => {
      if (!isMidLevel(levelData)) {
        console.warn("Navigate called on non-MidLevel:", levelData);
        return;
      }

      const selectedQuote = getSelectedQuote(levelData);
      if (!selectedQuote) {
        console.error('No selected quote found for navigation in level:', levelData);
        return;
      }

      const siblingsData = getSiblings(levelData);
      if (!siblingsData) {
        console.error('No siblings data found for navigation in level:', levelData);
        return;
      }

      const siblingsForQuote = siblingsData.levelsMap.find(
        ([quoteFromMap]) => quoteFromMap && selectedQuote && quoteFromMap.sourcePostId === selectedQuote.sourcePostId && quoteFromMap.text === selectedQuote.text && quoteFromMap.selectionRange.start === selectedQuote.selectionRange.start && quoteFromMap.selectionRange.end === selectedQuote.selectionRange.end
      );

      if (!siblingsForQuote || siblingsForQuote[1].length === 0) {
        console.error('No siblings found for the selected quote:', selectedQuote, 'in level:', levelData);
        return;
      }

      const currentSelectedNode = getSelectedNodeHelper(levelData);
      if (!currentSelectedNode) {
        console.error('No currently selected node found in level:', levelData);
        return;
      }

      const currentIndex = siblingsForQuote[1].findIndex(sibling => sibling.id === currentSelectedNode.id);

      if (currentIndex === -1) {
         console.error('Current selected node not found within its own sibling list:', currentSelectedNode, siblingsForQuote[1]);
         return;
      }

      if (currentIndex <= 0) {
        console.log('Already at the first sibling.');
        return;
      }

      const previousSibling = siblingsForQuote[1][currentIndex - 1];
      if (!previousSibling) {
         console.error('Previous sibling is unexpectedly undefined at index', currentIndex - 1, 'in', siblingsForQuote[1]);
         return;
      }

      try {
        await storyTreeOperator.setSelectedNode(previousSibling);
      } catch (error) {
        console.error("Failed to set selected node:", error);
      }

    }, [levelData]);

    // Create content component directly within Row
    const content = useMemo(() => {
      if (shouldHide) {
        return null;
      }
      return (
        <div className="normal-row-content">
          <StoryTreeLevelComponent
            levelData={levelData}
            navigateToNextSiblingCallback={navigateToNextSiblingCallback}
            navigateToPreviousSiblingCallback={navigateToPreviousSiblingCallback}
          />
        </div>
      );
    }, [levelData, shouldHide, navigateToNextSiblingCallback, navigateToPreviousSiblingCallback]);

    return (
      <div
        ref={rowRef}
        style={computedStyle}
        className="row-container"
        role="listitem"
        aria-label="Story content"
      >
        {content}
      </div>
    );
  }
);

// Add display name for better debugging
Row.displayName = 'Row';

export default Row; 