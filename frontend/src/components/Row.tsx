/**
 * Unified Row Component
 * This file contains a single component that handles all row functionality:
 * - Dynamic height management with resize observation
 * - StoryTreeLevel rendering with navigation callbacks
 * - Virtualization support for react-window
 */

import React, { useRef, useMemo, memo, useCallback, useEffect } from 'react';
import StoryTreeLevelComponent from './StoryTreeLevel';
import { StoryTreeLevel, StoryTreeNode } from '../types/types';
import { 
  getSelectedQuote, 
  getSiblings, 
  getSelectedNodeHelper, 
  isMidLevel
} from '../utils/levelDataHelpers';
import storyTreeOperator from '../operators/StoryTreeOperator';

// Row Component Props - update to remove react-window and sizing props
interface RowProps {
  levelData: StoryTreeLevel;
  shouldHide: boolean;
  index: number;
}

/**
 * Unified Row component that handles all row-related functionality
 * - Content rendering (height managed by content + Virtuoso)
 * - Style computation simplified
 */
const Row: React.FC<RowProps> = memo(
  ({
    levelData, 
    shouldHide,
    index
  }) => {
    // Check if hidden first
    if (shouldHide) {
      console.log(`Row rendering HIDDEN placeholder - index: ${index}`);
      // Return a minimal placeholder div with explicit small height
      return <div style={{ height: '1px', overflow: 'hidden' }} aria-hidden="true" />;
    }

    // --- If NOT hidden, render the actual row content --- 
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
      // No need to check shouldHide here, handled above
      console.log(`Row content memo: Rendering actual content - index: ${index}`);
      return (
        <div className="normal-row-content" style={{ margin: 0 }}>
          <StoryTreeLevelComponent
            levelData={levelData}
            navigateToNextSiblingCallback={navigateToNextSiblingCallback}
            navigateToPreviousSiblingCallback={navigateToPreviousSiblingCallback}
          />
        </div>
      );
    }, [levelData, navigateToNextSiblingCallback, navigateToPreviousSiblingCallback]);

    // Render the container div for a visible row
    // REMOVE minHeight and conditional height/opacity/overflow/pointerEvents
    return (
      <div
        style={{
            padding: '20px', // Apply padding only when visible
            boxSizing: 'border-box',
            // No minHeight, height, opacity, overflow, pointerEvents here
        }}
        className="row-container"
        role="listitem"
        aria-label="Story content"
        // aria-hidden is removed as we return placeholder when hidden
      >
        {content}
      </div>
    );
  }
);

// Add display name for better debugging
Row.displayName = 'Row';

// Memoize the Row component
export const MemoizedRow = React.memo(Row);

export default Row; 