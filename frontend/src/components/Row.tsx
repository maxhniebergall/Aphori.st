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
  isMidLevel,
} from '../utils/levelDataHelpers';
import { areQuotesEqual } from '../types/quote';
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
      return <div style={{ height: '1px', overflow: 'hidden' }} aria-hidden="true" />;
    }

    // Create navigation callbacks for StoryTreeLevel
    const navigateToNextSiblingCallback = useCallback(async () => {
      if (!isMidLevel(levelData) || !levelData.midLevel) {
        console.warn("Navigate called on non-MidLevel or invalid levelData:", levelData);
        return;
      }

      const siblingsData = getSiblings(levelData);
      if (!siblingsData || siblingsData.levelsMap.length === 0) {
        console.error('No siblings data or map found for navigation in level:', levelData);
        return;
      }

      // --- CORRECT SIBLINGS LIST SELECTION --- 
      // Get the quote that defines this level's context (selected in the parent)
      const relevantQuoteKey = levelData.midLevel.selectedQuote;
      
      // Find the siblings list in the map that matches the relevant quote
      const siblingsEntry = siblingsData.levelsMap.find(([quoteKey]) => {
        // Handle null cases explicitly before calling areQuotesEqual
        if (relevantQuoteKey === null && quoteKey === null) {
          return true; // Both are null, they match
        }
        if (relevantQuoteKey === null || quoteKey === null) {
          return false; // One is null, the other isn't, they don't match
        }
        // Both are non-null Quotes, now we can safely compare them
        return areQuotesEqual(quoteKey, relevantQuoteKey);
      });

      // Extract the list if found, otherwise it's an error/empty
      const siblingsList = siblingsEntry ? siblingsEntry[1] : [];
      // --- END CORRECT SIBLINGS LIST SELECTION ---

      if (!siblingsList || siblingsList.length === 0) {
        console.error('No siblings found for the relevant quote key in level:', levelData, relevantQuoteKey);
        return;
      }

      const currentSelectedNode = getSelectedNodeHelper(levelData);
      if (!currentSelectedNode) {
        console.error('No currently selected node found in level:', levelData);
        return;
      }

      const currentIndex = siblingsList.findIndex(sibling => sibling.id === currentSelectedNode.id);

      if (currentIndex === -1) {
         console.error('Current selected node not found within its own sibling list:', currentSelectedNode, siblingsList);
         return;
      }

      if (currentIndex >= siblingsList.length - 1) {
        console.log('Already at the last sibling.');
        return;
      }

      const nextSibling = siblingsList[currentIndex + 1];
      if (!nextSibling) {
         console.error('Next sibling is unexpectedly undefined at index', currentIndex + 1, 'in', siblingsList);
         return;
      }

      try {
        await storyTreeOperator.setSelectedNode(nextSibling);
      } catch (error) {
        console.error("Failed to set selected node:", error);
      }

    }, [levelData, levelData.midLevel?.selectedQuote, levelData.midLevel?.siblings]);

    const navigateToPreviousSiblingCallback = useCallback(async () => {
      if (!isMidLevel(levelData) || !levelData.midLevel) {
        console.warn("Navigate called on non-MidLevel or invalid levelData:", levelData);
        return;
      }

      const siblingsData = getSiblings(levelData);
       if (!siblingsData || siblingsData.levelsMap.length === 0) {
        console.error('No siblings data or map found for navigation in level:', levelData);
        return;
      }

      // --- CORRECT SIBLINGS LIST SELECTION --- 
      // Get the quote that defines this level's context (selected in the parent)
      const relevantQuoteKey = levelData.midLevel.selectedQuote;
      
      // Find the siblings list in the map that matches the relevant quote
      const siblingsEntry = siblingsData.levelsMap.find(([quoteKey]) => {
        // Handle null cases explicitly before calling areQuotesEqual
        if (relevantQuoteKey === null && quoteKey === null) {
          return true; // Both are null, they match
        }
        if (relevantQuoteKey === null || quoteKey === null) {
          return false; // One is null, the other isn't, they don't match
        }
        // Both are non-null Quotes, now we can safely compare them
        return areQuotesEqual(quoteKey, relevantQuoteKey);
      });

      // Extract the list if found, otherwise it's an error/empty
      const siblingsList = siblingsEntry ? siblingsEntry[1] : [];
      // --- END CORRECT SIBLINGS LIST SELECTION ---

      if (!siblingsList || siblingsList.length === 0) {
        console.error('No siblings found for the relevant quote key in level:', levelData, relevantQuoteKey);
        return;
      }

      const currentSelectedNode = getSelectedNodeHelper(levelData);
      if (!currentSelectedNode) {
        console.error('No currently selected node found in level:', levelData);
        return;
      }

      const currentIndex = siblingsList.findIndex(sibling => sibling.id === currentSelectedNode.id);

      if (currentIndex === -1) {
         console.error('Current selected node not found within its own sibling list:', currentSelectedNode, siblingsList);
         return;
      }

      if (currentIndex <= 0) {
        console.log('Already at the first sibling.');
        return;
      }

      const previousSibling = siblingsList[currentIndex - 1];
      if (!previousSibling) {
         console.error('Previous sibling is unexpectedly undefined at index', currentIndex - 1, 'in', siblingsList);
         return;
      }

      try {
        await storyTreeOperator.setSelectedNode(previousSibling);
      } catch (error) {
        console.error("Failed to set selected node:", error);
      }

    }, [levelData, levelData.midLevel?.selectedQuote, levelData.midLevel?.siblings]);

    // Create content component directly within Row
    const content = useMemo(() => {
      // No need to check shouldHide here, handled above
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
    return (
      <div
        style={{
            padding: '20px', // Apply padding only when visible
            boxSizing: 'border-box',
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