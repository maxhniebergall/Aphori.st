/**
 * Unified Row Component
 * This file contains a single component that handles all row functionality:
 * - Dynamic height management with resize observation
 * - StoryTreeLevel rendering with navigation callbacks
 * - Virtualization support for react-window
 */

import React, { useRef, useMemo, memo, useCallback, useEffect } from 'react';
import StoryTreeLevelComponent from './StoryTreeLevel';
import { StoryTreeLevel, StoryTreeNode, ACTIONS } from '../types/types';
import { Quote, areQuotesEqual } from '../types/quote';
import { 
  getSelectedQuoteInParent,
  getSiblings, 
  getSelectedNodeHelper, 
  isMidLevel,
  getLevelNumber,
} from '../utils/levelDataHelpers';
import storyTreeOperator from '../operators/StoryTreeOperator';
import { useStoryTree } from '../context/StoryTreeContext';

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

    const { dispatch } = useStoryTree();
    const levelNumber = useMemo(() => getLevelNumber(levelData), [levelData]);

    // Create simplified navigation callbacks for StoryTreeLevel
    const navigateToNextSiblingCallback = useCallback(() => {
      if (levelNumber === undefined) return;
      console.log(`[Row] Dispatching NAVIGATE_NEXT_SIBLING for level ${levelNumber}`);
      dispatch({ type: ACTIONS.NAVIGATE_NEXT_SIBLING, payload: { levelNumber } });
    }, [dispatch, levelNumber]);

    const navigateToPreviousSiblingCallback = useCallback(() => {
      if (levelNumber === undefined) return;
      console.log(`[Row] Dispatching NAVIGATE_PREV_SIBLING for level ${levelNumber}`);
      dispatch({ type: ACTIONS.NAVIGATE_PREV_SIBLING, payload: { levelNumber } });
    }, [dispatch, levelNumber]);

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